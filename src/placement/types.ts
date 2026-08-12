import type {
  ComponentManifest,
  DataClassification,
  Digest,
  IsolationLevel,
  PlacementRef,
  Scope,
} from "../core/types";
import type { ResourceLimits } from "../security/grants/types";

export interface SecurityContext {
  readonly effectiveCeilingDigest: Digest;
  readonly maximumClassification: DataClassification;
  readonly trustDomain: string;
  readonly scope: Scope;
  readonly securityCritical: boolean;
}

export interface PlacementRequest {
  readonly manifest: ComponentManifest;
  readonly schemaMinimum: IsolationLevel;
  readonly requestedIsolation: IsolationLevel;
  readonly trustedComputingBase: boolean;
  readonly observesClassification: DataClassification;
  readonly securityContext: SecurityContext;
  readonly configDigest: Digest;
  readonly limits: ResourceLimits;
  readonly snapshotManifestDigest?: Digest;
  readonly snapshotConfigDigest?: Digest;
}

export interface Sandbox {
  readonly id: PlacementRef;
  readonly isolation: IsolationLevel;
  readonly coldSpawned: boolean;
  readonly occupants: readonly string[];
}

export interface PlacementDecision {
  readonly ref: PlacementRef;
  readonly sandbox: Sandbox;
  readonly context: SecurityContext;
  readonly cgroups: CgroupSettings;
  readonly usedSnapshot: boolean;
  readonly state: "cold" | "open" | "draining";
}

export interface CgroupSettings {
  readonly cpuMax?: number;
  readonly memoryMaxBytes?: number;
  readonly pidsMax?: number;
  readonly ioMaxBytesPerSecond?: number;
}

export interface ContainerRuntimeProfile {
  readonly readOnlyRootFilesystem: true;
  readonly tmpfsScratch: true;
  readonly capabilitiesDropped: "ALL";
  readonly noNewPrivileges: true;
  readonly userNamespace: true;
  readonly seccompProfile: string;
  readonly appArmorProfile: string;
  readonly runtimeSocketMounted: false;
  readonly runtimeClass?: "gvisor" | "kata";
}

export interface CgroupCompilationInput {
  readonly limits: ResourceLimits;
}

export type EgressClassName =
  | "none"
  | "loopback"
  | "lan"
  | "declared"
  | "any";

export interface EgressClass {
  readonly kind: EgressClassName;
  readonly hosts: readonly string[];
}

export interface EgressPolicySources {
  readonly manifest: EgressClass;
  readonly template: EgressClass;
  readonly workspace: EgressClass;
  readonly organization: EgressClass;
}

export interface EgressRealization {
  readonly policy: EgressClass;
  readonly networkAttachment: "internal" | "none" | "host-bridge" | "filtered";
  readonly packetDestinations: readonly string[];
  readonly brokerDestinations: readonly string[];
}

export interface CompanionDeclaration {
  readonly name: string;
  readonly image: string;
  readonly egress: EgressClass;
  readonly endpoint: string;
  readonly tmpfs: readonly string[];
  readonly secretRefs: readonly string[];
  readonly manifestDigest: Digest;
}

export interface CompanionInstance {
  readonly id: string;
  readonly owner: PlacementRef;
  readonly declaration: CompanionDeclaration;
  readonly securityContext: SecurityContext;
  readonly effectiveEgress: EgressClass;
  readonly reachableBy: readonly PlacementRef[];
  readonly state: "open" | "draining" | "closed";
}

export interface CompanionCanary {
  probe(companion: CompanionInstance): Promise<boolean>;
}

export interface CompanionOpenRequest {
  readonly owner: PlacementRef;
  readonly context: SecurityContext;
  readonly ownerEgress: EgressClass;
  readonly declaration: CompanionDeclaration;
}
