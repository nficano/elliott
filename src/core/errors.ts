// Typed kernel errors — TDD §1, §2, §5d.

import type { ComponentKind, LifecycleState } from "./types";

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

/** Raised on the next brokered call after a handle is revoked (§1a, G6). */
export class GrantRevokedError extends Error {
  constructor(public readonly handle: string) {
    super(`Grant handle revoked: ${handle}`);
    this.name = "GrantRevokedError";
  }
}

/** Empty candidate set fails closed, never relaxes a filter (§5d, G9). */
export class NoEligibleRouteError extends Error {
  constructor(
    public readonly emptiedBy: string,
    public readonly lastSurvivors: readonly string[],
  ) {
    super(`No eligible model route; emptied by step "${emptiedBy}"`);
    this.name = "NoEligibleRouteError";
  }
}
