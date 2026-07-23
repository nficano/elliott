import { hashValue } from "../core/digest";
import { NoEligibleRouteError } from "../core/errors";
import { residencySatisfies } from "../security/residency/residency";
import { profileWithinCeiling } from "./profile";
import type { ProviderState } from "./provider/types";
import type {
  ResolvedModelRoute,
  RouteBuildContext,
  RouteFilterStep,
  RouteTableEntry,
  RouteTableKey,
} from "./routing/types";

const PREVIOUS_TRACE_INDEX = -2;

const routeId = (
  route: { readonly provider: string; readonly model: string; },
): string => `${route.provider}/${route.model}`;

const keyString = (key: RouteTableKey): string =>
  JSON.stringify({
    profile: key.profile,
    classification: key.effectiveClassification,
    requires: [...key.requiredCapabilities].sort((left, right) =>
      left.localeCompare(right)
    ),
  });

const providerFor = (
  providers: readonly ProviderState[],
  id: string,
): ProviderState | undefined =>
  providers.find((provider) => provider.id === id);

const traceStep = (
  trace: RouteFilterStep[],
  step: string,
  candidates: readonly ResolvedModelRoute[],
): void => {
  trace.push({ step, survivors: candidates.map(routeId) });
};

export const liveRouteFilter = (
  key: RouteTableKey,
  context: RouteBuildContext,
): readonly [readonly ResolvedModelRoute[], readonly RouteFilterStep[]] => {
  if (!profileWithinCeiling(key.profile, context.maximumProfile)) {
    throw new NoEligibleRouteError("profile-ceiling", []);
  }
  const binding = context.profiles.profiles[key.profile];
  if (binding === undefined || binding.unavailable === true) {
    throw new NoEligibleRouteError("profile-binding", []);
  }
  const trace: RouteFilterStep[] = [];
  let candidates = binding.routes.flatMap((route) => {
    const provider = providerFor(context.providers, route.provider);
    const catalog = provider?.catalog.find((entry) =>
      entry.modelId === route.model
    );
    return provider === undefined || catalog === undefined
      ? []
      : [{ ...route, catalog, residency: provider.residency }];
  });
  traceStep(trace, "catalog", candidates);
  candidates = candidates.filter((route) =>
    providerFor(context.providers, route.provider)?.health.healthy === true
    && route.catalog.available
  );
  traceStep(trace, "health", candidates);
  candidates = candidates.filter((route) =>
    key.requiredCapabilities.every((capability) =>
      route.catalog.capabilities.includes(capability)
    )
  );
  traceStep(trace, "capabilities", candidates);
  if (context.posture !== "standard") {
    candidates = candidates.filter((route) =>
      residencySatisfies(route.residency, key.effectiveClassification)
    );
  }
  traceStep(trace, "residency", candidates);
  candidates.sort((left, right) =>
    left.priority - right.priority || left.costMetric - right.costMetric
  );
  traceStep(trace, "ordering", candidates);
  return [Object.freeze(candidates), Object.freeze(trace)];
};

const stampsMatch = (
  table: RouteTableEntry,
  context: RouteBuildContext,
): boolean =>
  table.epochVector.org === context.epochVector.org
  && table.epochVector.workspace === context.epochVector.workspace
  && table.epochVector.agent === context.epochVector.agent
  && table.epochVector.session === context.epochVector.session
  && table.epochVector.principal === context.epochVector.principal
  && table.builtFromDigests.length === context.inputDigests.length
  && table.builtFromDigests.every(
    (value, index) => value === context.inputDigests[index],
  );

export class RouteTableStore {
  readonly #tables = new Map<string, RouteTableEntry>();
  readonly #providerKeys = new Map<string, Set<string>>();

  resolve(key: RouteTableKey, context: RouteBuildContext): RouteTableEntry {
    const encoded = keyString(key);
    const existing = this.#tables.get(encoded);
    if (existing !== undefined && stampsMatch(existing, context)) {
      return existing;
    }
    const [candidates, trace] = liveRouteFilter(key, context);
    if (candidates.length === 0) {
      const last = trace.at(PREVIOUS_TRACE_INDEX)?.survivors ?? [];
      throw new NoEligibleRouteError(trace.at(-1)?.step ?? "table-build", last);
    }
    const version = hashValue({ key, candidates, stamps: context });
    const table = Object.freeze({
      key,
      candidates,
      builtFromDigests: Object.freeze([...context.inputDigests]),
      epochVector: context.epochVector,
      version,
      trace,
    });
    this.#tables.set(encoded, table);
    for (const candidate of candidates) {
      const keys = this.#providerKeys.get(candidate.provider) ?? new Set();
      keys.add(encoded);
      this.#providerKeys.set(candidate.provider, keys);
    }
    return table;
  }

  invalidateProvider(provider: string): void {
    const keys = this.#providerKeys.get(provider) ?? new Set();
    for (const key of keys) this.#tables.delete(key);
    this.#providerKeys.delete(provider);
  }

  clear(): void {
    this.#tables.clear();
    this.#providerKeys.clear();
  }
}

export type * from "./routing/types";
