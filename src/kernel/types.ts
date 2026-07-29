import type { AuditCommitAdapter } from "../audit/types";
import type { Posture } from "../config/postures/types";
import type { RuntimeContractLoader } from "../core/discovery/types";

export interface AgentKernelOptions {
  readonly runtimeLoader?: RuntimeContractLoader;
  readonly validationLogicVersion?: string;
  readonly posture?: Posture;
  readonly snapshotDirectory?: string;
  // Where committed audit records are durably persisted. Defaults to an
  // in-memory adapter (records survive only for the process lifetime); the
  // runtime injects a FileCommitAdapter so the tamper-evident trail outlives
  // restarts. See src/audit/file-adapter.ts.
  readonly auditAdapter?: AuditCommitAdapter;
}
