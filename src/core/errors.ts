// Typed kernel errors — TDD §7.3, §7.4, §7.7d.

import type {
  ComponentKind,
  ComponentRef,
  Digest,
  IsolationLevel,
  LifecycleState,
} from "./types";

export class ComponentKindMismatchError extends Error {
  constructor(
    public readonly expected: ComponentKind,
    public readonly actual: ComponentKind,
  ) {
    super(`Expected component kind "${expected}", got "${actual}"`);
    this.name = "ComponentKindMismatchError";
  }
}

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly from: LifecycleState,
    public readonly to: LifecycleState,
  ) {
    super(`Illegal lifecycle transition ${from} -> ${to}`);
    this.name = "LifecycleTransitionError";
  }
}

/** Raised on the next brokered call after a handle is revoked (§7.3a, G6). */
export class GrantRevokedError extends Error {
  constructor(public readonly handle: string) {
    super(`Grant handle revoked: ${handle}`);
    this.name = "GrantRevokedError";
  }
}

/** Empty candidate set fails closed, never relaxes a filter (§7.7d, G9). */
export class NoEligibleRouteError extends Error {
  constructor(
    public readonly emptiedBy: string,
    public readonly lastSurvivors: readonly string[],
  ) {
    super(`No eligible model route; emptied by step "${emptiedBy}"`);
    this.name = "NoEligibleRouteError";
  }
}

export class SchemaResolutionError extends Error {
  constructor(public readonly schemaDigest: Digest) {
    super(`Unable to resolve component schema ${schemaDigest}`);
    this.name = "SchemaResolutionError";
  }
}

export class IsolationFloorError extends Error {
  constructor(
    public readonly requested: IsolationLevel,
    public readonly required: IsolationLevel,
  ) {
    super(`Isolation ${requested} is below required floor ${required}`);
    this.name = "IsolationFloorError";
  }
}

export class LifecycleHookError extends Error {
  constructor(
    public readonly phase: "open" | "close",
    public override readonly cause: unknown,
  ) {
    super(`Component lifecycle ${phase} hook failed`, { cause });
    this.name = "LifecycleHookError";
  }
}

export class RegistryCollisionError extends Error {
  constructor(public readonly ref: ComponentRef) {
    super(`Same-scope collision for ${ref}`);
    this.name = "RegistryCollisionError";
  }
}

export class PinnedShadowError extends Error {
  constructor(public readonly ref: ComponentRef) {
    super(`A narrower scope cannot shadow pinned component ${ref}`);
    this.name = "PinnedShadowError";
  }
}

export class RuntimeContractMismatchError extends Error {
  constructor(
    public readonly staticDigest: Digest,
    public readonly runtimeDigest: Digest,
  ) {
    super("Runtime contract differs from the validated static manifest");
    this.name = "RuntimeContractMismatchError";
  }
}

export class ManifestValidationError extends Error {
  constructor(
    public readonly reason: string,
    public override readonly cause?: unknown,
  ) {
    super(`Manifest validation failed: ${reason}`, { cause });
    this.name = "ManifestValidationError";
  }
}
