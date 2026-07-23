/** Capability layer (CAPABILITIES-TDD) — contracts, providers, the bus. */
export { degradeForModel, makeCapabilityBus } from "./bus.js";
export {
  changeFeed1,
  ContractCatalog,
  issueFeed1,
  makeStandardCatalog,
  metricRows1,
  pageFetch1,
  webSearch1,
} from "./contracts.js";
export { CapabilityError } from "./errors.js";
export { refOf } from "./types.js";
export type {
  CapabilityBusDeps,
  CapabilityContract,
  CapabilityCtx,
  CapabilityFailure,
  CapabilityInvoker,
  CapabilitySelection,
  ProviderDecl,
  ProviderImpl,
} from "./types.js";
