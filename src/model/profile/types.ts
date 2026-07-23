import type { Digest, Scope } from "../../core/types";
import type { ModelProfileId, ModelRoute, ReservedProfile } from "../types";

export interface ProfileBinding {
  readonly routes: readonly ModelRoute[];
  readonly unavailable?: boolean;
  readonly digest: Digest;
}

export interface ModelProfileConfiguration {
  readonly profiles: Readonly<Partial<Record<ModelProfileId, ProfileBinding>>>;
}

export interface ModelUsePolicy {
  readonly defaultProfile: ReservedProfile;
  readonly uses: Readonly<Record<string, ReservedProfile>>;
  readonly escalationChains: Readonly<
    Partial<Record<ReservedProfile, readonly ReservedProfile[]>>
  >;
}

export interface EscalationRequest {
  readonly activity: string;
  readonly from: ReservedProfile;
  readonly to: ReservedProfile;
  readonly ceiling: ReservedProfile;
  readonly hasDeepGrant: boolean;
  readonly scope: Scope;
}

export interface EscalationResult {
  readonly profile: ReservedProfile;
  readonly escalated: boolean;
  readonly reason?: "not-configured" | "ceiling" | "grant";
}
