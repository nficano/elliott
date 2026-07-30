// GrantSets, GrantHandles, and epoch-invalidated resolution — TDD §7.3, §7.3a.
// Capabilities compose by intersection; resource limits compose by
// element-wise minimum. Budgets are not capabilities.

import type { EpochCoordinates, EpochScope } from "../../core/epoch/types";
import type { Digest, EpochVector, GrantHandle } from "../../core/types";

export interface Capability {
  readonly capability: string;
  readonly resources: readonly string[];
  readonly deferred?: boolean;
}

export interface ResourceLimits {
  readonly maxConcurrency?: number;
  readonly cpuQuota?: number;
  readonly memoryMb?: number;
  readonly pids?: number;
  readonly ioBytesPerSecond?: number;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
}

export interface GrantSet {
  readonly capabilities: readonly Capability[];
  readonly limits: ResourceLimits;
}

/** Cached per GrantHandle, tagged with the epoch vector of contributing
 *  scopes; a vector mismatch forces full seven-source re-resolution (§7.3a). */
export interface ResolvedGrantEntry {
  readonly handle: GrantHandle;
  readonly grantSet: GrantSet;
  readonly epochVector: EpochVector;
  readonly revoked: boolean;
}

/** Per-capability explanation of which policy source removed it — §7.3
 *  `grants.explain`; always computed fresh, never from the cache. */
export interface GrantExplanation {
  readonly capability: string;
  readonly removedBy?: string;
}

export type CapabilityGrantSource =
  | "request"
  | "package"
  | "organization"
  | "workspace"
  | "agent"
  | "principal"
  | "session";

export type LimitGrantSource =
  | "organization"
  | "workspace"
  | "agent"
  | "session"
  | "invocation";

export interface CapabilitySource {
  readonly name: CapabilityGrantSource;
  readonly capabilities: readonly Capability[];
}

export interface LimitSource {
  readonly name: LimitGrantSource;
  readonly limits: ResourceLimits;
}

export interface GrantResolutionInput {
  readonly sources: readonly CapabilitySource[];
  readonly limitSources: readonly LimitSource[];
}

export interface GrantIssueInput extends GrantResolutionInput {
  readonly handle: GrantHandle;
  readonly coordinates: EpochCoordinates;
  readonly policyDigests: readonly Digest[];
  readonly onDrain: () => void;
}

export interface GrantPolicyState extends GrantIssueInput {
  readonly activeDeferred: ReadonlySet<string>;
  readonly revoked: boolean;
}

export interface GrantConsumption {
  readonly concurrency: number;
  readonly costUsd: number;
  readonly tokens: number;
}

export interface GrantPolicyUpdate {
  readonly sources: readonly CapabilitySource[];
  readonly limitSources: readonly LimitSource[];
  readonly policyDigests: readonly Digest[];
  readonly changedScope: EpochScope;
  readonly changedScopeId: string;
}
