// Elliott public surface. Consumers install Elliott as a standalone package
// and compose agents declaratively (TDD §0f, §16).

export { Component } from "./core/component/component";
export { defineComponent } from "./core/component/define";
export { EpochRegistry } from "./core/epoch/epochs";
export {
  ComponentKindMismatchError,
  GrantRevokedError,
  LifecycleTransitionError,
  NoEligibleRouteError,
} from "./core/errors";
export { ComponentRegistry } from "./core/registry/registry";
export type * from "./core/types";
export type * from "./core/waist/types";
export { AgentKernel } from "./kernel";
