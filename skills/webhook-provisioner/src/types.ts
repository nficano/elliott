import type { RuntimeSettings } from "../../../src/runtime/types";

export type WebhookProfileId = "hmac-sha256" | "token-query" | "slack-v2";

// One provisioned endpoint. Facility-minted profiles (hmac-sha256,
// token-query) carry their material inline — acceptable for phase 1, the
// state directory is already trusted. Sender-defined profiles (slack-v2)
// store only the settings reference, so endpoint storage never duplicates
// Vault-held material; the raw secret is resolved from settings at verify
// time. See docs/explanation/facilities.md.
export interface EndpointRecord {
  readonly slug: string;
  readonly consumer: string;
  readonly name: string;
  readonly profile: WebhookProfileId;
  readonly material?: string;
  readonly secretRef?: string;
  readonly maxBodyBytes: number;
  readonly expiresAt?: string;
}

export interface EndpointStore {
  all(): Promise<readonly EndpointRecord[]>;
  byName(consumer: string, name: string): Promise<EndpointRecord | undefined>;
  bySlug(slug: string): Promise<EndpointRecord | undefined>;
  save(record: EndpointRecord): Promise<void>;
  remove(slug: string): Promise<void>;
}

export interface IngressCounters {
  verified: number;
  dropped: number;
}

export interface IngressFacilityInput {
  readonly hooksBaseUrl: string;
  readonly settings: RuntimeSettings;
  readonly store: EndpointStore;
  readonly mount: (record: EndpointRecord) => void;
  readonly unmount: (slug: string) => void;
}

export interface DecodedWebhookConfig {
  readonly profile: WebhookProfileId;
  readonly secretRef?: string;
  readonly maxBodyBytes: number;
  readonly expiresAt?: string;
}

export interface VerificationInput {
  readonly request: Request;
  readonly body: string;
  readonly material: string;
}

export type WebhookVerifier = (input: VerificationInput) => boolean;

export interface VerificationRouteInput {
  readonly record: EndpointRecord;
  // Resolves the endpoint's verification material at request time — minted
  // material straight off the record, sender-defined material from settings.
  readonly material: (record: EndpointRecord) => string | undefined;
  readonly internalSecret: string;
  readonly port: number;
  readonly counters: IngressCounters;
  readonly report: (error: unknown, mechanism: string) => void;
}
