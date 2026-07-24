import type { Posture } from "../config/postures/types";
import type { RuntimeContractLoader } from "../core/discovery/types";

export interface AgentKernelOptions {
  readonly runtimeLoader?: RuntimeContractLoader;
  readonly validationLogicVersion?: string;
  readonly posture?: Posture;
  readonly snapshotDirectory?: string;
}
