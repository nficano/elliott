import type { ComponentInstance } from "../types";

export interface LifecycleHooks {
  readonly open: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly releaseGrant: () => Promise<void>;
}

export interface ManagedInstanceView {
  readonly value: ComponentInstance;
  readonly released: boolean;
}
