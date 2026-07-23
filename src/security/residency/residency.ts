import { scopeId } from "../../core/brands";
import { ManifestValidationError } from "../../core/errors";
import type { DataClassification } from "../../core/types";
import type { RecordAppender } from "../../core/waist/types";
import type { ModelCatalogEntry } from "../../model/types";
import type {
  EgressProbeResult,
  ResidencyGrant,
  ResidencyRegistration,
} from "./types";

const CLASSIFICATION_ORDER: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const hasExternalEgress = (probe: EgressProbeResult): boolean =>
  probe.tcpReachable || probe.udpReachable || probe.dnsReachable;

export const residencySatisfies = (
  grant: ResidencyGrant,
  classification: DataClassification,
): boolean =>
  !grant.revoked
  && CLASSIFICATION_ORDER.indexOf(classification)
    <= CLASSIFICATION_ORDER.indexOf(grant.maximumClassification);

export const assertCatalogResidencyConsistent = (
  catalog: readonly ModelCatalogEntry[],
  grant: ResidencyGrant,
): void => {
  const claimsLocal = catalog.some((entry) =>
    entry.declaredLocality === "local"
  );
  if (claimsLocal && grant.egress !== "none") {
    throw new ManifestValidationError(
      "provider claims local while holding external egress",
    );
  }
};

export class ResidencyRegistry {
  readonly #grants = new Map<string, ResidencyGrant>();
  readonly #records: RecordAppender;
  readonly #onRevoked: (provider: string) => Promise<void>;

  constructor(
    records: RecordAppender,
    onRevoked: (provider: string) => Promise<void>,
  ) {
    this.#records = records;
    this.#onRevoked = onRevoked;
  }

  async register(registration: ResidencyRegistration): Promise<void> {
    this.#assertProbe(registration);
    assertCatalogResidencyConsistent(
      registration.catalog,
      registration.grant,
    );
    await this.#records.append({
      type: "residency.registered",
      scope: {
        level: "organization",
        id: scopeId(registration.grant.provider),
      },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        provider: registration.grant.provider,
        grant: registration.grant.ref,
        topologyDigest: registration.grant.topologyDigest,
      },
    });
    this.#grants.set(registration.grant.ref, Object.freeze(registration.grant));
  }

  get(ref: string): ResidencyGrant | undefined {
    return this.#grants.get(ref);
  }

  async applyProbe(ref: string, probe: EgressProbeResult): Promise<void> {
    const grant = this.#grants.get(ref);
    if (grant === undefined) throw new Error(`Unknown ResidencyGrant ${ref}`);
    const invalid = probe.observedTopologyDigest !== grant.topologyDigest
      || (grant.egress === "none" && hasExternalEgress(probe));
    if (!invalid) return;
    await this.#records.append({
      type: "residency.revoked",
      scope: { level: "organization", id: scopeId(grant.provider) },
      durability: "effect-gating",
      classification: "internal",
      payload: { provider: grant.provider, grant: grant.ref },
    });
    this.#grants.set(ref, Object.freeze({ ...grant, revoked: true }));
    await this.#onRevoked(grant.provider);
  }

  #assertProbe(registration: ResidencyRegistration): void {
    if (
      registration.declaredTopologyDigest
        !== registration.probe.observedTopologyDigest
      || registration.grant.topologyDigest
        !== registration.probe.observedTopologyDigest
    ) {
      throw new ManifestValidationError(
        "declared provider topology diverges from probe results",
      );
    }
    if (
      registration.grant.egress === "none"
      && hasExternalEgress(registration.probe)
    ) {
      throw new ManifestValidationError(
        "local provider egress canary reached an external beacon",
      );
    }
  }
}

export type * from "./types";
