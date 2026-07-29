export { CapabilityGate } from "./capability-gate";
export { makeGovernanceControlPlane } from "./control-plane";
export { GovernanceDeniedError } from "./errors";
export { ToolGovernor } from "./governor";
export { GovernancePolicy } from "./policy";
export type {
  CapabilityGateDeps,
  CapabilityGateSpec,
  GovernanceControlPlaneBinding,
  GovernancePolicyInput,
  GovernanceStatus,
  PolicyDecision,
  PolicyEffect,
  ToolGovernorOptions,
} from "./types";
