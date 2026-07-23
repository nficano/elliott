// GrantSets, GrantHandles, and epoch-invalidated resolution — TDD §1, §1a.
// Capabilities compose by intersection; resource limits compose by
// element-wise minimum. Budgets are not capabilities.

import type { EpochVector, GrantHandle } from "../../core/types";

export interface Capability {
  readonly capability: string;
  readonly resources: readonly string[];
}

export interface ResourceLimits {
  readonly maxConcurrency?: number;
  readonly memoryMb?: number;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
}

export interface GrantSet {
  readonly capabilities: readonly Capability[];
  readonly limits: ResourceLimits;
}

/** Cached per GrantHandle, tagged with the epoch vector of contributing
 *  scopes; a vector mismatch forces full seven-source re-resolution (§1a). */
export interface ResolvedGrantEntry {
  readonly handle: GrantHandle;
  readonly grantSet: GrantSet;
  readonly epochVector: EpochVector;
  readonly revoked: boolean;
}

/** Per-capability explanation of which policy source removed it — §1
 *  `grants.explain`; always computed fresh, never from the cache. */
export interface GrantExplanation {
  readonly capability: string;
  readonly removedBy?: string;
}
