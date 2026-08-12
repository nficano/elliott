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

// Filter candidates to those inside the cost budget, then pick one with a
// sticky tie-break: reuse the previous selection when it is still tied with the
// front-runner, else take the front-runner. Pure; throws the same budget error
// as the caller when nothing survives. The returned stickyKey is what the
// caller writes back into its per-scope sticky map.
export const selectBudgetedRoute = (input: {
  readonly candidates: readonly ResolvedModelRoute[];
  readonly usage: DispatchUsage;
  readonly maxCostUsd: number | undefined;
  readonly previousStickyKey: string | undefined;
}): {
  readonly selected: ResolvedModelRoute;
  readonly budgeted: readonly ResolvedModelRoute[];
  readonly stickyKey: string;
} => {
  const { candidates, usage, maxCostUsd, previousStickyKey } = input;
  const budgeted = candidates.filter((candidate) =>
    maxCostUsd === undefined
    || estimateCost(candidate, usage) <= maxCostUsd
  );
  const first = budgeted[0];
  if (first === undefined) {
    throw new NoEligibleRouteError(
      "budget",
      candidates.map((route) => `${route.provider}/${route.model}`),
    );
  }
  const selected =
    budgeted.find((candidate) =>
      `${candidate.provider}/${candidate.model}` === previousStickyKey
      && tied(candidate, first)
    ) ?? first;
  return {
    selected,
    budgeted,
    stickyKey: `${selected.provider}/${selected.model}`,
  };
};

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
    const { selected, stickyKey } = selectBudgetedRoute({
      candidates: table.candidates,
      usage: request.usage,
      maxCostUsd: request.task.maxCostUsd,
      previousStickyKey: this.#sticky.get(request.scope.id),
    });
    this.#sticky.set(request.scope.id, stickyKey);
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
}

export type * from "./routing/types";
