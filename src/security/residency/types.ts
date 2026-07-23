import type {
  ComponentRef,
  DataClassification,
  Digest,
} from "../../core/types";
import type { ModelCatalogEntry } from "../../model/types";

export type EgressClass = "none" | "declared" | "unrestricted";

export interface ResidencyGrant {
  readonly ref: ComponentRef;
  readonly provider: string;
  readonly egress: EgressClass;
  readonly allowedDestinations: readonly string[];
  readonly maximumClassification: DataClassification;
  readonly topologyDigest: Digest;
  readonly verifiedAt: string;
  readonly revoked: boolean;
}

export interface EgressProbeResult {
  readonly tcpReachable: boolean;
  readonly udpReachable: boolean;
  readonly dnsReachable: boolean;
  readonly observedTopologyDigest: Digest;
}

export interface ResidencyRegistration {
  readonly grant: ResidencyGrant;
  readonly catalog: readonly ModelCatalogEntry[];
  readonly declaredTopologyDigest: Digest;
  readonly probe: EgressProbeResult;
}

export interface ResidencyProbe {
  run(provider: string): Promise<EgressProbeResult>;
}
