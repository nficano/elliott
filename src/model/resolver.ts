import { hashValue } from "../core/digest";
import { NoEligibleRouteError } from "../core/errors";
import type { DataClassification } from "../core/types";
import type { RecordAppender } from "../core/waist/types";
import { maximumClassification } from "../prompt/index";
import { RouteTableStore } from "./routetable";
import type {
  DispatchDecision,
  DispatchRequest,
  DispatchUsage,
  ModelSelectionRecord,
  ResolvedModelRoute,
  RouteTableKey,
  SelectionRecordBuild,
} from "./routing/types";

const TOKENS_PER_THOUSAND = 1000;

const estimateCost = (
  route: ResolvedModelRoute,
  usage: DispatchUsage,
): number => {
  const inputRate = route.catalog.costPerThousandInputTokensUsd;
  const outputRate = route.catalog.costPerThousandOutputTokensUsd;
  if (inputRate === undefined || outputRate === undefined) {
    return Infinity;
  }
  return usage.promptInputTokens / TOKENS_PER_THOUSAND * inputRate
    + usage.maximumOutputTokens / TOKENS_PER_THOUSAND * outputRate;
};

const tied = (left: ResolvedModelRoute, right: ResolvedModelRoute): boolean =>
  left.priority === right.priority && left.costMetric === right.costMetric;

const underDeclared = (
  declared: DataClassification,
  frame: DataClassification,
): boolean => maximumClassification([declared, frame]) !== declared;

const buildSelectionRecord = (
  input: SelectionRecordBuild,
): ModelSelectionRecord =>
  Object.freeze({
    requestedProfile: input.request.task.profile,
    effectiveProfile: input.request.task.profile,
    declaredClassification: input.request.task.declaredClassification,
    frameHighWaterMark: input.request.frameClassification,
    effectiveClassification: input.effectiveClassification,
    underDeclared: underDeclared(
      input.request.task.declaredClassification,
      input.request.frameClassification,
    ),
    requestedAlias: input.request.task.profile,
    provider: input.selected.provider,
    model: input.selected.model,
    residencyGrantRef: input.selected.residency.ref,
    selectionReason: "priority-cost-budget",
    routeTableVersion: input.table.version,
    profileDigest: input.request.profileDigest,
    catalogDigest: input.selected.catalog.catalogDigest,
    inputTokens: input.request.usage.promptInputTokens,
    cachedInputTokens: input.request.usage.cachedInputTokens,
    outputTokens: input.request.usage.actualOutputTokens,
    latencyMs: input.request.usage.latencyMs,
    costUsd: input.costUsd,
  });

export class ModelDispatcher {
  readonly #tables: RouteTableStore;
  readonly #records: RecordAppender;
  readonly #sticky = new Map<string, string>();

  constructor(tables: RouteTableStore, records: RecordAppender) {
    this.#tables = tables;
    this.#records = records;
  }

  async select(request: DispatchRequest): Promise<DispatchDecision> {
    const effectiveClassification = maximumClassification([
      request.task.declaredClassification,
      request.frameClassification,
    ]);
    const key: RouteTableKey = {
      profile: request.task.profile,
      effectiveClassification,
      requiredCapabilities: request.task.requires,
    };
    const table = this.#tables.resolve(key, request.build);
    const budgeted = table.candidates.filter((candidate) =>
      request.task.maxCostUsd === undefined
      || estimateCost(candidate, request.usage) <= request.task.maxCostUsd
    );
    if (budgeted.length === 0) {
      throw new NoEligibleRouteError(
        "budget",
        table.candidates.map((route) => `${route.provider}/${route.model}`),
      );
    }
    const selected = this.#stickySelection(request.scope.id, budgeted);
    const costUsd = estimateCost(selected, request.usage);
    const record = buildSelectionRecord({
      request,
      selected,
      table,
      effectiveClassification,
      costUsd,
    });
    await this.#records.append({
      type: "model.selection",
      scope: request.scope,
      durability: "observational",
      classification: effectiveClassification,
      payload: { ...record },
    });
    return Object.freeze({
      route: selected,
      record,
      cacheIdentity: hashValue({
        prefix: request.promptPrefixDigest,
        profile: request.task.profile,
        provider: selected.provider,
        model: selected.model,
      }),
    });
  }

  clearStickiness(scopeId?: string): void {
    if (scopeId === undefined) this.#sticky.clear();
    else this.#sticky.delete(scopeId);
  }

  #stickySelection(
    scope: string,
    candidates: readonly ResolvedModelRoute[],
  ): ResolvedModelRoute {
    const first = candidates[0];
    if (first === undefined) throw new NoEligibleRouteError("budget", []);
    const previous = this.#sticky.get(scope);
    const selected =
      candidates.find((candidate) =>
        `${candidate.provider}/${candidate.model}` === previous
        && tied(candidate, first)
      ) ?? first;
    this.#sticky.set(scope, `${selected.provider}/${selected.model}`);
    return selected;
  }
}

export type * from "./routing/types";
