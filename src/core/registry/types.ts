import type {
  CapabilityRequest,
  ComponentManifest,
  ComponentRef,
  Digest,
  PrincipalId,
  ProtocolDescriptor,
  ProtocolId,
  ResourceLimitRequest,
  Scope,
  SnapshotId,
} from "../types";
import type { Envelope, Invocation, SecurityTagValue } from "../waist/types";

export type RegistryAvailability = "available" | "unavailable";

export interface RegistrationOptions {
  readonly scope: Scope;
  readonly availability?: RegistryAvailability;
  readonly pinned?: boolean;
  readonly reason?: string;
}

export interface RegistryEntry {
  readonly manifest: ComponentManifest;
  readonly scope: Scope;
  readonly availability: RegistryAvailability;
  readonly pinned: boolean;
  readonly reason?: string;
}

export interface RegistryResolution {
  readonly ref: ComponentRef;
  readonly selected: RegistryEntry;
  readonly shadowed: readonly RegistryEntry[];
}

export interface LockfileResolution {
  readonly ref: ComponentRef;
  readonly selectedScope: Scope;
  readonly selectedDigest: string;
  readonly availability: RegistryAvailability;
  readonly shadowedScopes: readonly Scope[];
}

export interface ComponentCard {
  readonly ref: ComponentRef;
  readonly kind: string;
  readonly description: string;
  readonly operationSummaries: readonly string[];
  readonly risk: "none" | "low" | "elevated";
  readonly availability: RegistryAvailability;
  readonly digest: Digest;
}

export interface ComponentInspectionDetail {
  readonly card: ComponentCard;
  readonly protocols: readonly ProtocolDescriptor[];
}

export interface PrepareComponentCallInput {
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
  readonly budget: ResourceLimitRequest;
  readonly snapshot: SnapshotId;
}

export interface PreparedComponentCall {
  readonly invocation: Invocation;
  readonly inspection: ComponentInspectionDetail;
}
