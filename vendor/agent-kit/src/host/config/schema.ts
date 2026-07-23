import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_STORE_POOL_SIZE = 10;
const DEFAULT_VECTOR_DIMENSIONS = 768;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_MAX_PARALLEL_REQUESTS = 12;
const DEFAULT_PROFILE_MAX_TOKENS = 1024;
const DEFAULT_PROFILE_TEMPERATURE = 0.4;
const DEFAULT_COLD_TOKEN_BUDGET = 6000;
const DEFAULT_MONTHLY_BUDGET_USD = 200;
const DEFAULT_PER_TURN_BUDGET_USD = 0.5;

/**
 * Config schema — ARCHITECTURE §5, on `effect/Schema`. One layered, validated
 * tree. `process.env` is read in exactly one module (the loader); everything
 * else is YAML. Invalid *optional* sections disable their feature + emit one
 * error event; an invalid *core* section (store/llm) fails fast.
 *
 * Note on defaults: zod's `.default({})` on a nested struct cascades the inner
 * field defaults. A section whose default is "the fully-defaulted struct"
 * decodes `{}` through its own schema to reproduce that cascade
 * (`sectionDefault`).
 */

const TierName = Schema.Literals([
  "utility",
  "trivial",
  "fast",
  "standard",
  "deep",
]);
const DEFAULT_TIER: typeof TierName.Type = "fast";
const VectorType = Schema.Literals(["vector", "halfvec"]);
const DEFAULT_VECTOR_TYPE: typeof VectorType.Type = "vector";

/** The fully-defaulted decode of `{}` through a section — zod `.default({})` parity. */
function sectionDefault<S extends Schema.Decoder<unknown>>(
  schema: S,
): () => S["Type"] {
  const decode = Schema.decodeUnknownSync(schema);
  return () => decode({});
}

function withDefault<S extends Schema.Top>(
  schema: S,
  value: () => S["Type"],
) {
  return schema.pipe(
    Schema.withDecodingDefaultType(Effect.sync(value)),
  );
}

export const ModelRow = Schema.Struct({
  model: Schema.String,
  context_window: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
});

const RuntimeSchema = Schema.Struct({
  timezone: withDefault(Schema.String, () => "America/New_York"),
  http: withDefault(
    Schema.Struct({
      port: withDefault(
        Schema.Number.check(Schema.isInt()),
        () => DEFAULT_HTTP_PORT,
      ),
    }),
    () => ({ port: DEFAULT_HTTP_PORT }),
  ),
  /** Vault-sourced bearer for control routes /config/*, /footprint (§3 authz). */
  control_token: Schema.optional(Schema.RedactedFromValue(Schema.String)),
});

const StoreSchema = Schema.Struct({
  dsn: Schema.String,
  pool: withDefault(
    Schema.Struct({
      max: withDefault(
        Schema.Number.check(Schema.isInt()),
        () => DEFAULT_STORE_POOL_SIZE,
      ),
    }),
    () => ({ max: DEFAULT_STORE_POOL_SIZE }),
  ),
  vectors: withDefault(
    Schema.Struct({
      dim: withDefault(
        Schema.Number.check(Schema.isInt()),
        () => DEFAULT_VECTOR_DIMENSIONS,
      ),
      type: withDefault(
        VectorType,
        () => DEFAULT_VECTOR_TYPE,
      ),
    }),
    () => ({
      dim: DEFAULT_VECTOR_DIMENSIONS,
      type: DEFAULT_VECTOR_TYPE,
    }),
  ),
  backup: withDefault(
    Schema.Struct({
      wal_archive: Schema.optional(Schema.String),
      dump_cron: withDefault(Schema.String, () => "0 4 * * *"),
    }),
    () => ({ dump_cron: "0 4 * * *" }),
  ),
  statement_timeout_ms: withDefault(
    Schema.Number.check(Schema.isInt()),
    () => DEFAULT_STATEMENT_TIMEOUT_MS,
  ),
  lock_timeout_ms: withDefault(
    Schema.Number.check(Schema.isInt()),
    () => DEFAULT_LOCK_TIMEOUT_MS,
  ),
});

const BrowserSchema = Schema.Struct({
  daemon_url: Schema.optional(Schema.String),
  /** Vault-sourced bearer for runtime→daemon (§18). Without it the network can drive Chromium. */
  token: Schema.optional(Schema.String),
  allowed_domains: withDefault(Schema.Array(Schema.String), () => []),
  downloads: withDefault(Schema.Boolean, () => false),
});

const LlmSchema = Schema.Struct({
  base_url: Schema.String,
  api_key: Schema.RedactedFromValue(Schema.String),
  max_parallel: withDefault(
    Schema.Number.check(Schema.isInt()),
    () => DEFAULT_MAX_PARALLEL_REQUESTS,
  ),
  models: Schema.Struct({
    utility: ModelRow,
    trivial: ModelRow,
    fast: ModelRow,
    standard: ModelRow,
    deep: ModelRow,
    embed: ModelRow,
  }),
  profiles: Schema.Record(
    Schema.String,
    Schema.Struct({
      max_tokens: withDefault(
        Schema.Number.check(Schema.isInt()),
        () => DEFAULT_PROFILE_MAX_TOKENS,
      ),
      temperature: withDefault(
        Schema.Number,
        () => DEFAULT_PROFILE_TEMPERATURE,
      ),
      preferred_model: Schema.optional(Schema.String),
    }),
  ),
  prompt_cache: withDefault(Schema.Boolean, () => true),
  /** modelPolicy.allow wildcard allowlist (§9 guardrail). */
  allow: withDefault(Schema.Array(Schema.String), () => ["*"]),
});

const BudgetsSchema = Schema.Struct({
  cold_tokens_max: withDefault(
    Schema.Number.check(Schema.isInt()),
    () => DEFAULT_COLD_TOKEN_BUDGET,
  ),
  monthly_usd_max: withDefault(
    Schema.Number,
    () => DEFAULT_MONTHLY_BUDGET_USD,
  ),
  per_turn_usd_max: withDefault(
    Schema.Number,
    () => DEFAULT_PER_TURN_BUDGET_USD,
  ),
});

const ObservabilitySchema = Schema.Struct({
  otel: Schema.Struct({ endpoint: Schema.String }),
  langfuse: Schema.optional(
    Schema.Struct({
      host: Schema.String,
      public_key: Schema.String,
      secret_key: Schema.RedactedFromValue(Schema.String),
    }),
  ),
  /** GlitchTip exception reporting (§12) — dsn arrives via `${VAULT:…}`. */
  glitchtip: Schema.optional(
    Schema.Struct({
      dsn: Schema.String,
      environment: Schema.optional(Schema.String),
      release: Schema.optional(Schema.String),
    }),
  ),
  logs: withDefault(
    Schema.Struct({
      pii: withDefault(Schema.Boolean, () => false),
    }),
    () => ({ pii: false }),
  ),
});

const NotifySchema = Schema.Struct({
  webhook_url: Schema.String,
  token: Schema.optional(Schema.String),
  default_channels: withDefault(
    Schema.Array(Schema.String),
    () => ["telegram"],
  ),
});

const ChannelSchema = Schema.StructWithRest(
  Schema.Struct({ enabled: withDefault(Schema.Boolean, () => false) }),
  [Schema.Record(Schema.String, Schema.Unknown)], // per-channel fields validated by the channel's own manifest
);

export const BundleSchema = Schema.Struct({
  tier: withDefault(TierName, () => DEFAULT_TIER),
  /** Global ordinal for deterministic serialization (§10.1 cache correctness). */
  order: Schema.optional(Schema.Number.check(Schema.isInt())),
});

/** Standard required config values merged into every registrable (§6).
 *  Opt-in (CAPABILITIES-TDD §5): `enabled` defaults FALSE — a pre-staged config
 *  block activates nothing until it says `enabled: true`. */
export const RegistrableBase = Schema.StructWithRest(
  Schema.Struct({
    enabled: withDefault(Schema.Boolean, () => false),
    tier: Schema.optional(TierName),
    profile: Schema.optional(Schema.String),
    bundle: Schema.optional(Schema.String),
    schedule: Schema.optional(Schema.String),
    budget: Schema.optional(Schema.Number),
    footprint_budget_tokens: Schema.optional(
      Schema.Number.check(Schema.isInt()),
    ),
    preconnect: Schema.optional(Schema.Boolean),
    /** Version-range pin when multiple majors of one id are registered (TDD §7). */
    version: Schema.optional(Schema.String),
    /** Declared-secret values, `${VAULT:…}`/`${ENV:…}`-interpolated (TDD §6). */
    secrets: Schema.optional(
      Schema.Record(Schema.String, Schema.String),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)], // skill/mcp-specific fields validated by the manifest's configSchema
);

/** `capabilities.<ref>` — which provider serves a capability, + fallbacks (TDD §3.4). */
export const CapabilitySelectionSchema = Schema.Struct({
  provider: Schema.String,
  fallback: withDefault(Schema.Array(Schema.String), () => []),
});

const ChannelsSchema = Schema.Record(Schema.String, ChannelSchema);
const BundlesSchema = Schema.Record(Schema.String, BundleSchema);
const CapabilitiesSchema = Schema.Record(
  Schema.String,
  CapabilitySelectionSchema,
);
const RegistrablesSchema = Schema.Record(Schema.String, RegistrableBase);

const emptyChannels = (): typeof ChannelsSchema.Type => ({});
const emptyBundles = (): typeof BundlesSchema.Type => ({});
const emptyCapabilities = (): typeof CapabilitiesSchema.Type => ({});
const emptyRegistrables = (): typeof RegistrablesSchema.Type => ({});

export const ConfigSchema = Schema.Struct({
  runtime: withDefault(RuntimeSchema, sectionDefault(RuntimeSchema)),
  store: StoreSchema,
  browser: Schema.optional(BrowserSchema),
  llm: LlmSchema,
  budgets: withDefault(BudgetsSchema, sectionDefault(BudgetsSchema)),
  observability: Schema.optional(ObservabilitySchema),
  notify: Schema.optional(NotifySchema),
  channels: withDefault(ChannelsSchema, emptyChannels),
  bundles: withDefault(BundlesSchema, emptyBundles),
  capabilities: withDefault(CapabilitiesSchema, emptyCapabilities),
  skills: withDefault(RegistrablesSchema, emptyRegistrables),
  mcp: withDefault(RegistrablesSchema, emptyRegistrables),
  plugins: withDefault(RegistrablesSchema, emptyRegistrables),
  agents: withDefault(RegistrablesSchema, emptyRegistrables),
});

export type {
  AgentKitConfig,
  BundleConfig,
  CapabilitySelectionConfig,
  ModelRowT,
  RegistrableConfig,
} from "./types.js";

/** Core sections whose failure must fail the process (§5). */
export const CORE_SECTIONS = ["store", "llm"] as const;
