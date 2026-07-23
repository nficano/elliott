import type {
  Capability,
  CapabilitySource,
  GrantExplanation,
  GrantResolutionInput,
  GrantSet,
  ResourceLimits,
} from "./types";

const WILDCARD_SUFFIX_LENGTH = 2;

const wildcardPrefix = (value: string): string | undefined =>
  value.endsWith("/**")
    ? value.slice(0, -WILDCARD_SUFFIX_LENGTH)
    : undefined;

const intersectResource = (left: string, right: string): string | undefined => {
  if (left === right) return left;
  const leftPrefix = wildcardPrefix(left);
  const rightPrefix = wildcardPrefix(right);
  if (leftPrefix !== undefined && right.startsWith(leftPrefix)) return right;
  if (rightPrefix !== undefined && left.startsWith(rightPrefix)) return left;
  return undefined;
};

const intersectResources = (
  left: readonly string[],
  right: readonly string[],
): readonly string[] => {
  const resources = new Set<string>();
  for (const first of left) {
    for (const second of right) {
      const value = intersectResource(first, second);
      if (value !== undefined) resources.add(value);
    }
  }
  return [...resources].sort((left, right) => left.localeCompare(right));
};

const sourceCapability = (
  source: CapabilitySource,
  capability: string,
): Capability | undefined =>
  source.capabilities.find((candidate) => candidate.capability === capability);

const minimum = (
  values: readonly (number | undefined)[],
): number | undefined => {
  const present = values.filter((value): value is number =>
    value !== undefined
  );
  return present.length === 0 ? undefined : Math.min(...present);
};

const limits = (input: GrantResolutionInput): ResourceLimits => {
  const maxConcurrency = minimum(
    input.limitSources.map((source) => source.limits.maxConcurrency),
  );
  const memoryMb = minimum(
    input.limitSources.map((source) => source.limits.memoryMb),
  );
  const cpuQuota = minimum(
    input.limitSources.map((source) => source.limits.cpuQuota),
  );
  const pids = minimum(
    input.limitSources.map((source) => source.limits.pids),
  );
  const ioBytesPerSecond = minimum(
    input.limitSources.map((source) => source.limits.ioBytesPerSecond),
  );
  const maxCostUsd = minimum(
    input.limitSources.map((source) => source.limits.maxCostUsd),
  );
  const maxTokens = minimum(
    input.limitSources.map((source) => source.limits.maxTokens),
  );
  return {
    ...(maxConcurrency !== undefined && { maxConcurrency }),
    ...(cpuQuota !== undefined && { cpuQuota }),
    ...(memoryMb !== undefined && { memoryMb }),
    ...(pids !== undefined && { pids }),
    ...(ioBytesPerSecond !== undefined && { ioBytesPerSecond }),
    ...(maxCostUsd !== undefined && { maxCostUsd }),
    ...(maxTokens !== undefined && { maxTokens }),
  };
};

export const resolveGrantSet = (
  input: GrantResolutionInput,
  activeDeferred: ReadonlySet<string> = new Set(),
): GrantSet => {
  const request = input.sources.find((source) => source.name === "request");
  if (request === undefined) return { capabilities: [], limits: limits(input) };
  const capabilities = request.capabilities.flatMap((requested) => {
    if (
      requested.deferred === true && !activeDeferred.has(requested.capability)
    ) {
      return [];
    }
    let resources = requested.resources;
    for (const source of input.sources) {
      if (source.name === "request") continue;
      const allowed = sourceCapability(source, requested.capability);
      if (allowed === undefined) return [];
      resources = intersectResources(resources, allowed.resources);
      if (resources.length === 0) return [];
    }
    return [{ capability: requested.capability, resources }];
  });
  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    limits: Object.freeze(limits(input)),
  });
};

export const explainGrant = (
  input: GrantResolutionInput,
  capability: string,
  activeDeferred: ReadonlySet<string> = new Set(),
): GrantExplanation => {
  for (const source of input.sources) {
    const allowed = sourceCapability(source, capability);
    if (allowed === undefined) return { capability, removedBy: source.name };
    if (allowed.deferred === true && !activeDeferred.has(capability)) {
      return { capability, removedBy: "deferred-approval" };
    }
  }
  return { capability };
};

export type * from "./types";
