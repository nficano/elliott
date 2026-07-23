import type {
  CapabilityRequest,
  ComponentManifest,
  ComponentRef,
  Digest,
  IsolationLevel,
  ProtocolDescriptor,
  SchemaRef,
} from "../types";

export type ValidationVerdict = "valid" | "quarantined";
export type DiscoveryAvailability = "available" | "unavailable";

export interface StaticPackageDescriptor {
  readonly root: string;
  readonly packageDigest: Digest;
  readonly manifest: ComponentManifest;
  readonly moduleSpecifier: string;
  readonly requestedIsolation: IsolationLevel;
  readonly schemaDigests: readonly Digest[];
  readonly provenanceTrustRoot: Digest;
  readonly runtimeContractHash: Digest;
}

export interface RuntimeContract {
  readonly schema: SchemaRef;
  readonly protocols: readonly ProtocolDescriptor[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
}

export interface RuntimeContractLoader {
  load(descriptor: StaticPackageDescriptor): Promise<RuntimeContract>;
}

export interface ValidationCacheEntry {
  readonly packageDigest: Digest;
  readonly schemaDigests: readonly Digest[];
  readonly provenanceTrustRoot: Digest;
  readonly validationLogicVersion: string;
  readonly runtimeContractHash: Digest;
  readonly verdict: ValidationVerdict;
}

export interface ValidationCacheQuery {
  readonly packageDigest: Digest;
  readonly schemaDigests: readonly Digest[];
  readonly provenanceTrustRoot: Digest;
  readonly validationLogicVersion: string;
}

export interface DiscoveredComponent {
  readonly ref: ComponentRef;
  readonly descriptor: StaticPackageDescriptor;
  readonly availability: DiscoveryAvailability;
  readonly reason?: string;
}

export interface ScanCounters {
  readonly parsed: number;
  readonly provenanceVerified: number;
  readonly cacheHits: number;
}
