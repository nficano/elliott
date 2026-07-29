import { randomBytes } from "node:crypto";
import { isJsonRecord } from "../../../src/providers/http";
import type {
  FacilityBinding,
  FacilityDescriptor,
  FacilityRequest,
  JsonRecord,
} from "../../../src/runtime/skills/types";
import type { RuntimeSettings } from "../../../src/runtime/types";
import { endpointPath, internalPath } from "./routes";
import type {
  DecodedWebhookConfig,
  EndpointRecord,
  IngressFacilityInput,
  WebhookProfileId,
} from "./types";

export const FACILITY_ID = "ingress.webhook";
export const FACILITY_VERSION = 1;

const SLUG_BYTES = 16;
const SECRET_BYTES = 32;
const DEFAULT_MAX_BODY_BYTES = 65_536;
const MIN_BODY_BYTES = 1024;
const MAX_BODY_BYTES = 1_048_576;
const MINTED_PROFILES: ReadonlySet<WebhookProfileId> = new Set([
  "hmac-sha256",
  "token-query",
]);

export const ingressWebhookFacility = (
  input: IngressFacilityInput,
): FacilityBinding => ({
  id: FACILITY_ID,
  version: FACILITY_VERSION,
  describe: describeIngressWebhook,
  acquire: async (request) => {
    const record = await endpointFor(input, request);
    await input.store.save(record);
    input.mount(record);
    return {
      grantId: grantId(record.slug),
      facility: `${FACILITY_ID}@${FACILITY_VERSION}`,
      values: {
        url: `${trimSlash(input.hooksBaseUrl)}${endpointPath(record.slug)}`,
        internalPath: internalPath(record.slug),
        ...(record.material !== undefined && { secret: record.material }),
      },
    };
  },
  release: async (id) => {
    const slug = slugFromGrantId(id);
    const record = await input.store.bySlug(slug);
    if (record === undefined) throw new Error(`No endpoint for grant ${id}`);
    await input.store.remove(slug);
    input.unmount(slug);
  },
});

// Idempotent per (consumer, name): a re-acquire keeps the slug — and with it
// the public URL the consumer registered with the sender — and keeps minted
// material unless the verification profile changed.
const endpointFor = async (
  input: IngressFacilityInput,
  request: FacilityRequest,
): Promise<EndpointRecord> => {
  const config = decodeConfig(request.config, input.settings);
  const existing = await input.store.byName(request.consumer, request.name);
  const material = mintedMaterial(config.profile, existing);
  return {
    slug: existing?.slug ?? base64Url(randomBytes(SLUG_BYTES)),
    consumer: request.consumer,
    name: request.name,
    profile: config.profile,
    ...(material !== undefined && { material }),
    ...(config.secretRef !== undefined && { secretRef: config.secretRef }),
    maxBodyBytes: config.maxBodyBytes,
    ...(config.expiresAt !== undefined && { expiresAt: config.expiresAt }),
  };
};

const mintedMaterial = (
  profile: WebhookProfileId,
  existing: EndpointRecord | undefined,
): string | undefined => {
  if (!MINTED_PROFILES.has(profile)) return undefined;
  if (existing?.profile === profile) return existing.material;
  return base64Url(randomBytes(SECRET_BYTES));
};

const decodeConfig = (
  config: JsonRecord,
  settings: RuntimeSettings,
): DecodedWebhookConfig => {
  const verification = config["verification"];
  if (!isJsonRecord(verification)) {
    throw new Error("verification is required");
  }
  const profile = verification["profile"] as WebhookProfileId;
  const secretRef = decodeSecretRef(profile, verification["secretRef"]);
  if (
    secretRef !== undefined
    && resolveSettingsRef(settings, secretRef) === undefined
  ) {
    // Fail at acquire time, not first delivery: a dormant secret would
    // otherwise produce an endpoint that can never verify anything.
    throw new Error(`secretRef ${secretRef} resolves to no settings value`);
  }
  return {
    profile,
    ...(secretRef !== undefined && { secretRef }),
    maxBodyBytes: clampedBodyBytes(config["maxBodyBytes"]),
    ...decodeExpiry(config["expiresAt"]),
  };
};

const decodeSecretRef = (
  profile: WebhookProfileId,
  value: unknown,
): string | undefined => {
  if (profile === "slack-v2") {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Profile ${profile} requires a secretRef`);
    }
    return value;
  }
  if (value !== undefined) {
    throw new Error(`Profile ${profile} mints its own secret; drop secretRef`);
  }
  return undefined;
};

const decodeExpiry = (value: unknown): { readonly expiresAt?: string; } => {
  if (value === undefined) return {};
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError("expiresAt must be an ISO-8601 date");
  }
  return { expiresAt: value };
};

const clampedBodyBytes = (value: unknown): number => {
  if (typeof value !== "number") return DEFAULT_MAX_BODY_BYTES;
  return Math.max(MIN_BODY_BYTES, Math.min(MAX_BODY_BYTES, Math.floor(value)));
};

// Sender-defined verification material arrives as a *reference* into the
// resolved runtime settings (e.g. "slack.signingSecret"), never as a raw
// value through the acquire call — grant storage never duplicates Vault
// material.
export const resolveSettingsRef = (
  settings: RuntimeSettings,
  ref: string,
): string | undefined => {
  let cursor: unknown = settings;
  for (const key of ref.split(".")) {
    if (!isJsonRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
};

const grantId = (slug: string): string => `${FACILITY_ID}:${slug}`;

const slugFromGrantId = (id: string): string => {
  const prefix = `${FACILITY_ID}:`;
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(`Grant ${id} does not belong to ${FACILITY_ID}`);
  }
  return id.slice(prefix.length);
};

const trimSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const base64Url = (bytes: Buffer): string => bytes.toString("base64url");

export const describeIngressWebhook = (): FacilityDescriptor => ({
  id: FACILITY_ID,
  version: FACILITY_VERSION,
  description: "A verified public webhook endpoint behind the hooks "
    + "hostname: acquire returns the public URL to register with the sender "
    + "plus the internal route the consumer must serve. Verification profiles: "
    + "hmac-sha256 and token-query (facility mints the secret and returns it "
    + "in the grant), slack-v2 (sender secret referenced from settings).",
  requestSchema: {
    type: "object",
    required: ["verification"],
    additionalProperties: false,
    properties: {
      verification: {
        type: "object",
        required: ["profile"],
        additionalProperties: false,
        properties: {
          profile: {
            type: "string",
            enum: ["hmac-sha256", "token-query", "slack-v2"],
          },
          secretRef: { type: "string" },
        },
      },
      maxBodyBytes: { type: "integer" },
      expiresAt: { type: "string" },
    },
  },
  grantSchema: {
    type: "object",
    required: ["url", "internalPath"],
    additionalProperties: false,
    properties: {
      url: { type: "string" },
      internalPath: { type: "string" },
      secret: { type: "string" },
    },
  },
});
