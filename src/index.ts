// Elliott public surface. Consumers install Elliott as a standalone package
// and compose agents declaratively (TDD §7.2f, §7.18).

export { AgentComposer, scaffoldConsumerAgent } from "./agent/index";
export { BUNDLED_CATALOG } from "./catalog/index";
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
export {
  createNativeScanner,
  isNativeScannerAvailable,
  LinearDfaScanner,
  TypeScriptLinearDfaScanner,
} from "./hotcore/index";
export type {
  IncrementalScanner,
  ScanMatch,
  ScannerBackend,
} from "./hotcore/types";
export { AgentKernel } from "./kernel";
