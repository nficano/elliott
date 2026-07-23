import type { Digest } from "../../core/types";

export interface ConfigurationRevision {
  readonly id: string;
  readonly digest: Digest;
  readonly parentDigest?: Digest;
  readonly touchedEpochs: readonly string[];
  readonly policyDigests: readonly Digest[];
  readonly createdAt: string;
}

export interface ActivationSecurityDelta {
  readonly widenedCapabilities: readonly string[];
  readonly narrowedCapabilities: readonly string[];
  readonly classificationChanged: boolean;
}

export interface ActivationEpochEvent {
  readonly revision: ConfigurationRevision;
  readonly touchedEpochs: readonly string[];
  readonly policyDigests: readonly Digest[];
}

export interface ActivationHooks {
  evaluateSecurityDelta(
    active: ConfigurationRevision,
    candidate: ConfigurationRevision,
  ): Promise<ActivationSecurityDelta>;
  startCandidate(candidate: ConfigurationRevision): Promise<void>;
  healthCheck(candidate: ConfigurationRevision): Promise<boolean>;
  commit(event: ActivationEpochEvent): Promise<void>;
  discard(candidate: ConfigurationRevision): Promise<void>;
}

export interface ActivationResult {
  readonly type: "activated" | "rejected" | "stale";
  readonly active: ConfigurationRevision;
  readonly delta?: ActivationSecurityDelta;
}
