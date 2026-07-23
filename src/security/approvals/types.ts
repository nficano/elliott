import type { Posture } from "../../config/postures/types";
import type {
  ComponentRef,
  Digest,
  ProtocolId,
  ScopeId,
} from "../../core/types";
import type { CapabilityRequest } from "../../core/types";

export type ApprovalDecision =
  | "allow-once"
  | "deny-once"
  | "allow-session"
  | "propose-policy";

export type ApprovalPurpose =
  | "tool-invocation"
  | "deferred-grant"
  | "layer-3-declassification";

export interface ApprovalRequest {
  readonly id: string;
  readonly purpose: ApprovalPurpose;
  readonly invocationId: string;
  readonly session: ScopeId;
  readonly target: ComponentRef;
  readonly protocol: ProtocolId;
  readonly operation: string;
  readonly canonicalInput: string;
  readonly inputDigest: Digest;
  readonly schemaDigest: Digest;
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly preparedPlanDigest: Digest;
  readonly expiresAt: string;
  readonly deferredScope?: DeferredApprovalScope;
}

export interface DeferredApprovalScope {
  readonly posture: Posture;
  readonly workspace: ScopeId;
  readonly invocationClass: string;
}

export interface ApprovalOutcome {
  readonly request: ApprovalRequest;
  readonly decision: ApprovalDecision;
  readonly operator: string;
  readonly decidedAt: string;
  readonly proposalId?: string;
}

export interface ApprovalDecisionInput {
  readonly requestId: string;
  readonly decision: ApprovalDecision;
  readonly operator: string;
  readonly presentedCanonicalInput: string;
  readonly decidedAt?: string;
}
