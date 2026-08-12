import type {
  DataClassification,
  Digest,
  EpochVector,
  Scope,
} from "../../core/types";
import type { ResidencyGrant } from "../../security/residency/types";
import type { ModelProfileConfiguration } from "../profile/types";
import type { ProviderState } from "../provider/types";
import type {
  ModelCapability,
  ModelCatalogEntry,
  ModelRoute,
  ModelTask,
  ReservedProfile,
} from "../types";

export type RuntimePosture = "standard" | "hardened" | "regulated";

export interface RouteTableKey {
  readonly profile: ReservedProfile;
  readonly effectiveClassification: DataClassification;
  readonly requiredCapabilities: readonly ModelCapability[];
}

export interface ResolvedModelRoute extends ModelRoute {
  readonly catalog: ModelCatalogEntry;
  readonly residency: ResidencyGrant;
}

export interface RouteFilterStep {
  readonly step: string;
  readonly survivors: readonly string[];
}

export interface RouteTableEntry {
  readonly key: RouteTableKey;
  readonly candidates: readonly ResolvedModelRoute[];
  readonly builtFromDigests: readonly Digest[];
  readonly epochVector: EpochVector;
  readonly version: Digest;
  readonly trace: readonly RouteFilterStep[];
}

export interface RouteBuildContext {
  readonly profiles: ModelProfileConfiguration;
  readonly maximumProfile: ReservedProfile;
  readonly providers: readonly ProviderState[];
  readonly posture: RuntimePosture;
  readonly epochVector: EpochVector;
  readonly inputDigests: readonly Digest[];
}

export interface DispatchUsage {
  readonly promptInputTokens: number;
  readonly maximumOutputTokens: number;
  readonly actualOutputTokens: number;
  readonly cachedInputTokens: number;
  readonly latencyMs: number;
}

export interface DispatchRequest {
  readonly task: ModelTask;
  readonly frameClassification: DataClassification;
  readonly profileDigest: Digest;
  readonly promptPrefixDigest: Digest;
  readonly scope: Scope;
  readonly usage: DispatchUsage;
  readonly build: RouteBuildContext;
}

export interface ModelSelectionRecord {
  readonly requestedProfile: ReservedProfile;
  readonly effectiveProfile: ReservedProfile;
  readonly declaredClassification: DataClassification;
  readonly frameHighWaterMark: DataClassification;
  readonly effectiveClassification: DataClassification;
  readonly underDeclared: boolean;
  readonly requestedAlias: string;
  readonly provider: string;
  readonly model: string;
  readonly residencyGrantRef: string;
  readonly selectionReason: string;
  readonly routeTableVersion: Digest;
  readonly profileDigest: Digest;
  readonly catalogDigest: Digest;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly costUsd: number;
}

export interface DispatchDecision {
  readonly route: ResolvedModelRoute;
  readonly record: ModelSelectionRecord;
  readonly cacheIdentity: Digest;
}

export interface SelectionRecordBuild {
  readonly request: DispatchRequest;
  readonly selected: ResolvedModelRoute;
  readonly table: RouteTableEntry;
  readonly effectiveClassification: DataClassification;
  readonly costUsd: number;
}
