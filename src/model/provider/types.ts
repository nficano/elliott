import type { Digest } from "../../core/types";
import type { ResidencyGrant } from "../../security/residency/types";
import type {
  HealthStatus,
  ModelCatalogEntry,
  ModelProviderProtocol,
} from "../types";

export interface CachedProviderHealth {
  readonly healthy: boolean;
  readonly detail?: string;
  readonly reportedAtMs: number;
  readonly cadenceMs: number;
}

export interface ProviderState {
  readonly id: string;
  readonly protocol: ModelProviderProtocol;
  readonly residency: ResidencyGrant;
  readonly catalog: readonly ModelCatalogEntry[];
  readonly catalogDigest: Digest;
  readonly health: CachedProviderHealth;
}

export interface ProviderRegistrationInput {
  readonly id: string;
  readonly protocol: ModelProviderProtocol;
  readonly residency: ResidencyGrant;
  readonly catalog: readonly ModelCatalogEntry[];
  readonly health: HealthStatus;
  readonly reportedAtMs: number;
  readonly cadenceMs: number;
}
