import type {
  CapabilityRequest,
  ComponentRef,
  DataClassification,
  Digest,
  PrincipalId,
  ProtocolId,
  ResourceLimitRequest,
  Scope,
  SnapshotId,
} from "../types";

export type ActorTrust = "anonymous" | "asserted" | "authenticated";
export type ContentTrust = "trusted" | "external" | "untrusted";
export type RecordDurability = "effect-gating" | "observational";

export interface SecurityTagValue {
  readonly source: ComponentRef;
  readonly classification: DataClassification;
  readonly reason: string;
}

export interface Envelope<Payload = unknown> {
  readonly id: string;
  readonly principal?: PrincipalId;
  readonly actorTrust: ActorTrust;
  readonly contentTrust: ContentTrust;
  readonly classification: DataClassification;
  readonly securityTags: readonly SecurityTagValue[];
  readonly payload: Payload;
  readonly createdAt: string;
}

export interface Invocation {
  readonly id: string;
  readonly principal: PrincipalId;
  readonly agent: ComponentRef;
  readonly target: ComponentRef;
  readonly protocol: ProtocolId;
  readonly operation: string;
  readonly input: unknown;
  readonly inputSchemaDigest: Digest;
  readonly outputSchemaDigest: Digest;
  readonly origin: Envelope;
  readonly securityTags: readonly SecurityTagValue[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly deadline?: string;
  readonly budget: ResourceLimitRequest;
  readonly snapshot: SnapshotId;
  readonly preparedPlanDigest?: Digest;
}

export interface Grant {
  readonly id: string;
  readonly invocationId: string;
  readonly principal: PrincipalId;
  readonly capability: string;
  readonly resource: string;
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly expiresAt?: string;
  readonly policyDecision: Digest;
  readonly approvalId?: string;
}

export interface RecordEvent {
  readonly id: string;
  readonly type: string;
  readonly scope: Scope;
  readonly durability: RecordDurability;
  readonly classification: DataClassification;
  readonly timestamp: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly previousDigest?: Digest;
  readonly digest: Digest;
}

export interface RecordDraft {
  readonly id?: string;
  readonly type: string;
  readonly scope: Scope;
  readonly durability: RecordDurability;
  readonly classification: DataClassification;
  readonly timestamp?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RecordAppender {
  append(draft: RecordDraft): Promise<RecordEvent>;
}
