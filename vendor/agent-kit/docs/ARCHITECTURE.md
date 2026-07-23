# agent-kit — Architecture Design

> Status: **rev 4 (freeze candidate).** Successor to clawkit; from scratch, no
> OpenClaw. **Clean-room: agent-kit depends on nothing from `@tmh/*`.** The
> TeachMeHIPAA `@tmh/ai` / `@tmh/agents` packages and the `dan-agent` /
> `seo-agent` services are studied as **prior art only** — every useful pattern
> is reimplemented from scratch here, owned outright. The feature set to cover
> comes from oslo/clawkit.
>
> Rev 2 folded in an architecture review: Postgres sidecar (three containers);
> bundles + a tool-search meta-tool; router off the network path; a split CI gate;
> one OTel pipeline; git-authoritative prompts; memory provenance.
>
> Rev 3 folds in a pattern-mining pass over two production agent codebases
> (**NousResearch/hermes-agent** and **openclaw/openclaw**), which independently
> converged on this design and supply the implementation-level details:
> `tool_search` disclosure specifics + `bundle_non_core_tools` (§10.1),
> tool-pair-safe compaction (§10.4), forked-observer safety invariants +
> `skill-creator` (§13), markdown-skill eligibility + exposure flags +
> manifest-before-code (§6, §8), content-free telemetry hooks (§12), a `utility`
> tier (§9), `[SILENT]`/script-prepass scheduling (§15), untrusted-surface bundle
> (§16), memory prefetch/sync lifecycle (§7.4), config last-known-good (§5). Every
> such addition is attributed inline.
>
> Rev 4 folds in a build-readiness review: 7 correctness fixes (`utility` tier,
> Postgres SQL vocab, an immutable `tools` array + `invoke_tool` dispatcher,
> deterministic bundle serialization, tokenizer calibration, pgvectorscale/halfvec
> + iterative-scan, all M0 spike items), 11 design-gap paragraphs (LISTEN/NOTIFY
> durability, advisory-lock pooling, approval↔action binding, mixed-provenance +
> cross-origin dedupe, browser/control-API authz, secret + config-reload
> lifecycle, late observer reports, steering placement), 7 new §20 edge cases, and
> **appendices (§27): DDL, envelope schema, error taxonomy, backup/restore,
> cached-token mapping.** Type sketches are illustrative, not final.
>
> **Companion doc:** [`CAPABILITIES-TDD.md`](CAPABILITIES-TDD.md) (rev 4 +) —
> the clean-room abstraction pass over the `@tmh` prior art. It adds
> **capability contracts** (versioned input/output interfaces with
> config-selected, trait-differentiated providers), **declared secrets** with
> per-registrable scoping, **in-repo versioning** (semver + config range pins,
> `<id>@<major>` contract refs), **call-chain tracing**, opt-in enablement
> (`enabled: true` required — presence of a config block no longer enables), and
> three pack additions (`skills/watch`, `skills/ops`, extended `skills/web` +
> `integrations`). Where it touches §5/§6/§8/§21/§26 it is the authoritative
> amendment.

---

## 0. Purpose & non-goals

**Purpose.** `agent-kit` is a **reusable framework** — the runtime that hosts a
fleet of personal agents (chat + scheduled + reactive): a tool-calling loop,
durable memory, a scheduler, background workers, channel adapters
(Telegram/Slack/iMessage/HTTP), a generic web/browser skill pack, and the
observability/self-improvement/footprint machinery — all driven by YAML config.
It ships **nothing operator-specific**: no personas, no fleet, no secrets.

**`agent-oslo` is the first consumer.** It depends on `agent-kit` and supplies
what makes *oslo* oslo: the YAML config, the persona and prompts, the specific
agents/skills (briefing, youtube-dvr, imessage-\*, email-\*, home-assistant-write,
security, main — alert delivery goes out through the homelab notify webhook,
§16.4), the environment integrations (Gmail, BlueBubbles, Home Assistant),
secrets wiring, and deployment. **§24 is
the authoritative "what goes where" boundary.** **Packaging: two separate repos**
(`~/code/agent-kit`, `~/code/agent-oslo`), one-way dependency, boundary
lint-enforced.

**Non-goals.**
- Not a multi-tenant SaaS. Single operator per consumer, single trust domain.
- The framework hosts no fleet of its own — the 12 named agents are the
  consumer's, built on agent-kit primitives (see §17, §24).
- Not a generic OpenClaw/clawkit clone — we own the loop.
- **Not a microservice mesh.** Target is **three containers** (runtime +
  Postgres + browser), kept as few as possible; all subsystems are in-process
  within the runtime (§3). "As few containers as possible," not "one at any
  cost."
- **Not built on `@tmh/*`.** No dependency, import, or copied file. It is
  reference material; agent-kit is a clean-room reimplementation (§21). "Proven
  in the reference" means the *idea* is proven — the code is ours.
- LiteLLM, Langfuse, SigNoz, Vault, MinIO, Home Assistant, and BlueBubbles are
  **external shared infra** already in the homelab; agent-kit is a client of
  them, not a host of them.

---

## 1. Design principles (the requirements, as invariants)

1. **Adding a feature costs zero until it runs.** Lazy instantiation is the core
   performance lever: a skill/MCP that is disabled or unused this turn adds no
   init cost, no cold tokens, no latency. Enforced by lazy registry activation
   (§6) and bundle-based tool disclosure (§10); the Effect service graph (§4)
   keeps process dependencies explicit and shared. Growth is measured, not
   assumed (§11).
2. **Every component has a measured footprint.** Cold-token cost, init latency,
   and per-turn attributed latency/tokens are computed per component. "This MCP
   added N cold tokens and ~10 ms p50" is a number the system produces (§11).
3. **Config is data; behavior is code.** All wiring, model/tier routing,
   enable/disable, budgets, and schedules live in YAML. Prompts + tool
   descriptions are git-versioned disk assets. Code reads config; `process.env`
   is read in exactly one place (secrets only).
4. **Errors are values; nothing blocks boot.** `Effect.Effect<A, E>`-typed ports,
   tagged errors, best-effort side effects. Memory/history/browser/Langfuse/a
   broken skill degrade the feature, never the process. (Postgres is the one
   hard dependency — §5, §20.)
5. **Untrusted content is data, never instructions** — in the request path *and*
   across time. Read/write agent segregation, ingress injection inspection,
   envelope handoff, human-gated writes, **and memory provenance so an injected
   "fact" can't be recalled later as trusted context** (§16).
6. **The system watches itself and proposes its own improvements** — but every
   change is measured against a dataset and gated by a human, via a git PR (§13).

---

## 2. Patterns we reimplement, and what we do differently

The `@tmh/*` packages are prior art. We **reimplement** the ideas below from
scratch — nothing is imported or copied.

**Reimplement from scratch (ideas proven in the reference):**
- Two-layer split: provider-agnostic **core** (llm/agent/mcp/memory, ports-only)
  under a product **host** (config→clients→registry→runtime).
- `ToolDef {name, description, parameters, execute}` + `makeRegistry`, and the
  Effect Schema-first `define(spec)` where the model-facing JSON Schema is
  *derived* from the Effect `Schema` and inbound args are decoded before the
  handler runs.
- Registry decorators (`withApprovalGate`, `withBackgroundInvestigate`,
  `instrumentTools`) — layer HITL/delegation/observability without touching the
  loop.
- Single OpenAI-compatible **LiteLLM** gateway, `provider/model` string routing,
  a **client-side per-key concurrency semaphore**, non-streaming retry +
  per-round retry, streaming with `include_usage` for token telemetry.
- Deterministic evidence trails from real tool calls; a single `onModelCall`
  wrap seam (§8.3); `gen_ai.*` span hierarchy; content out of logs.
- Composition-root factory returning a frozen `Deps`; nullable-config-section =
  feature flag.

**Do differently (the agent-kit deltas):**
- **An explicit Effect `Context.Service` / `Layer` application graph** instead
  of one opaque composition factory. Process services are shared by one
  `ManagedRuntime`; optional registrables remain lazily activated, which keeps
  "adding features free" honest (§4/§6).
- **A first-class Registry with a required-config contract and a cost profile**
  for *every* registrable kind (§6).
- **Footprint accounting as a subsystem** — static cold-token measurement at
  registration + dynamic attribution at runtime + a **split** regression gate.
  Marquee feature; no analog in the reference (§11).
- **Bundle-based tool disclosure + a tool-search meta-tool** — the reference
  dumps ~40 tool schemas every turn; a fleet will have hundreds. We expose a
  small set of *stable tool bundles* and a search meta-tool for the long tail,
  so the model never sees hundreds of schemas **and** the cache prefix stays
  stable (§10). This is what makes "adding skills won't degrade performance" true.
- **One Postgres** (pgvector + pgvectorscale) instead of Qdrant + Redis +
  Postgres. Same simplification argument as clawkit's three-store sprawl, with no
  embedded-store ceilings — see §3. (Three containers total.)
- **Native constrained decoding** (schema-as-tool, single pass) as the default
  for structured output, with prose→JSON only as a fallback (§10.3).
- **One OTel pipeline** fanning out to SigNoz + Langfuse in a collector; prompts
  are **git-authoritative**, Langfuse is for traces/scores/datasets/annotation
  (§12). **No Sentry.**
- **YAML config** (reference uses TS `defineEnv`); env is only for secrets.

---

## 3. Runtime & container model

**Target: three containers.** All subsystems are in-process within the one Bun
runtime (a turn, a scheduled job, a background worker, and a channel listener
share memory, the application service `Context`, the concurrency gate, and
trace context with no IPC). Only the two jobs that genuinely want isolation are
split out.

| Container | Holds | Why separate |
| --- | --- | --- |
| **agent-kit** | the runtime: one Bun process, all subsystems in-process | the no-IPC argument is about *process*, not container |
| **postgres** | every durable thing (memory vectors, jobs, history, schedule, footprint ledger, kv) | one dependency replaces sqlite-vec + a hand-rolled queue + ledger + FTS, and it's good at all five jobs |
| **agent-browser** | Chromium + the Rust CDP daemon (+ headed-Playwright/Xvfb fallback) | it *executes untrusted content by design* — isolate it from Vault secrets, write tools, and the DB (§19); also session persistence across runtime redeploys, own resource limits, smaller base image |

Everything else stays external homelab infra (LiteLLM, Langfuse, SigNoz, Vault,
Home Assistant, BlueBubbles, MinIO).

- **Runtime: Bun + TypeScript** — native TS, fast cold start, built-in test/WS.
  **Risk to retire in M0 (§23.1):** OTel context propagation relies on
  `AsyncLocalStorage`, and Bun's auto-instrumentation has been a rough edge.
  Observability is the marquee feature, so M0 includes a concrete spike (nested
  spans across an async tool call, correct parent/child in SigNoz). If it fails,
  fall back to Node 22 — decide in M0, not M3.
- **Process supervisor.** Ordered startup + graceful shutdown of subsystems
  backed by the application `Layer`: `observability → config → store(pg) → llm
  → registry → channels → scheduler → workers → http-control`. Each implements
  `{ start(); stop(); health() }`.
- **The store: Postgres** (dedicated instance — **not** the Langfuse Postgres).
  It does five jobs, each with a first-class primitive:
  - **Vectors** — `pgvector` 0.8 + `pgvectorscale` (StreamingDiskANN): real ANN
    and, critically, **filtered ANN** (`WHERE collection=… AND origin='internal'`
    on an index) — exactly what §7.4 recall and the memory-provenance fix need.
    Needs `hnsw.iterative_scan=relaxed_order` for the filter to keep recall (§7.4);
    the `halfvec`-vs-diskann compatibility is an **M0 spike item** (§7.4/§23.2).
  - **Job queue** — `SELECT … FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` (§14).
  - **Hybrid retrieval** — built-in FTS (`ts_rank_cd`) or ParadeDB `pg_search`
    (BM25) fused with vectors via RRF, in one query (§10.1, §7.4).
  - **Footprint ledger** — a time series; native partitioning (or a Timescale
    hypertable for continuous aggregates behind `/footprint`) (§11).
  - **History / relational / kv** — table stakes.
  - **Migrations** use the Effect SQL migrator. A compatibility bridge validates
    and mirrors the former `schema_migrations` baseline into the dedicated
    `effect_sql_migrations` ledger.
    Every vector row stores `embed_model_id` + `dim`; changing embedding models
    triggers **dual-write + background reindex** (retrofitting this is misery).
  - **Driver choice:** `@effect/sql-pg` provides the scoped pool and Effect SQL
    client. Queue notifications use a retrying `PgClient.listen` stream;
    scheduler ownership uses `SqlClient.reserve` so the advisory lock stays on
    one physical connection; migrations run multi-statement SQL unprepared.
  - **Backup:** `pg_dump` nightly + WAL archiving to MinIO → point-in-time
    recovery. In M0.
  - Dimension tip: store `halfvec` (fp16) or Matryoshka-truncate 1536→768;
    index-in-RAM is what makes ANN fast.
- **Ingress + egress.** One HTTP server (Hono): `/healthz`, `/readyz`, a control
  API (footprint reports, config reload, job status, manual triggers), and
  inbound event/channel webhooks (fronted by the injection screen, §16).
  Outbound alert delivery is the same server's egress side — a POST to the
  homelab notify webhook (§16.4), so agent-kit never manages per-channel delivery
  secrets itself.
  - **Authz, not just network.** "LAN-only via Traefik" is a network assumption,
    not an access control. The **control routes (`/config/*`, `/footprint`,
    manual triggers) require a Vault-sourced bearer token**; the injection screen
    fronts *ingress* webhooks, which is a different surface. Health routes are open.

```
 external homelab infra:  LiteLLM · Langfuse · SigNoz · Vault · Home Assistant · BlueBubbles · MinIO
        ▲            ▲            ▲
 ┌──────┴────────────┴────────────┴────────── agent-kit (one Bun process) ────────────┐
 │  ingress(Hono) → injection-screen → dispatch                                       │
 │        ▼                                                                            │
 │  agent runtime (loop) ─ tool router (bundles + search meta-tool) ─ registry ─       │
 │        │ onModelCall → OTel                         skills / mcp clients / plugins   │
 │  scheduler · background workers · footprint ledger · self-improve                   │
 └────────┬──────────────────────────────────────────────────────┬────────────────────┘
          │ SQL (pooled)                                           │ HTTP
          ▼                                                        ▼
 ┌───────────────────────────────┐                    ┌──────────────────────────────┐
 │ postgres                      │                    │ agent-browser                │
 │ pgvector + pgvectorscale      │                    │ Chromium + CDP daemon        │
 │ memory · jobs · history       │                    │ (untrusted content;          │
 │ schedule · footprint ledger   │                    │  egress-allowlisted; no route │
 │ pg_dump + WAL → MinIO         │                    │  to Postgres / control API)  │
 └───────────────────────────────┘                    └──────────────────────────────┘
```

**Going to 2:** drop the browser container, keep Chromium in the runtime image;
keep Postgres. Never the reverse — an embedded store to save a container while
running Chromium in-process is the worst of both.

---

## 4. Dependency injection

**Effect-native, typed, explicit DI — no reflection, no decorators.**
Process-lifetime dependencies are `Context.Service` classes. Each service class
is also its typed `Context.Key`; implementations are assembled as a `Layer`,
acquired once by `ManagedRuntime`, and shared by turns, jobs, channels, and
lifecycle hooks.

```ts
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

class ConfigSvc
  extends Context.Service<ConfigSvc, ConfigStore>()("Config") {}
class LlmSvc extends Context.Service<LlmSvc, LlmPort>()("Llm") {}

type ServiceGet = <I, S>(key: Context.Key<I, S>) => S;

const AppLayer = Layer.mergeAll(
  Layer.succeed(ConfigSvc)(config),
  Layer.succeed(LlmSvc)(llm),
);
const runtime = ManagedRuntime.make(AppLayer);
```

- **Shared process services.** The app `Layer` provides config, store, LLM,
  registry, memory, routing, jobs, and observability once. `ManagedRuntime`
  provides the stable boundary used by HTTP handlers, workers, schedules, and
  channels, and its disposal closes the Effect-owned layer scope.
- **Lazy registrables.** Skills, MCPs, and plugins are indexed at boot but
  `activate()` only on first bundle/capability use (§6). Activation is traced,
  and static footprint is recorded after successful activation (§11).
- **Request state stays request-scoped.** A turn/job carries trace/session ids,
  its immutable config snapshot, selected tools, steering channel, and budget
  accumulator in `TurnCtx`; none is installed as a process-lifetime service.
- **Explicit access.** Host programs use `yield* Svc`; framework/consumer
  callbacks receive a `ServiceGet` accepting any declared `Context.Key`.
  Services are composed in `bootstrap/context.ts`, so the graph stays greppable.

---

## 5. Configuration (YAML)

One layered, validated tree. **`process.env` is read in exactly one module**
(secrets + a few deploy knobs); everything else is YAML.

**Layering (later overrides earlier):** `defaults.yaml` → `agent-kit.yaml` →
`agent-kit.<env>.yaml` (dev disables live channels) → `${VAULT:…#field}` /
`${ENV}` interpolation (secrets never inlined).

```yaml
runtime:
  timezone: America/New_York
  http: { port: 8080 }

store:                             # dedicated Postgres — NOT the langfuse instance
  dsn: ${VAULT:secret/services/agent-kit#postgres_dsn}
  pool: { max: 10 }
  vectors: { dim: 768, type: halfvec }        # Matryoshka-truncated / fp16
  backup: { wal_archive: s3://minio/agent-kit-wal, dump_cron: "0 4 * * *" }

browser:
  daemon_url: http://agent-browser:9000       # HTTP to the browser container
  allowed_domains: []

llm:
  base_url: https://api.litellm.h12o.io/v1
  api_key: ${VAULT:secret/services/agent-kit#litellm_key}
  max_parallel: 12
  models:                          # TIER → model + metadata (§9). context_window
                                   # feeds §10.1 disclosure threshold + §10.4 probe.
    utility:  { model: tier-local,                 context_window: 32768 }  # internal meta-calls (§9)
    trivial:  { model: tier-local,                 context_window: 32768 }  # $0 Ollama route
    fast:     { model: anthropic/claude-haiku-4-5, context_window: 200000 }
    standard: { model: anthropic/claude-sonnet-5,  context_window: 200000 }
    deep:     { model: anthropic/claude-opus-4-8,  context_window: 200000 }
    embed:    { model: tier-local-embed }          # embeddings for recall (not a chat tier)
  profiles:                        # PROFILE → task shape (orthogonal to tier, §9)
    default: { max_tokens: 1024, temperature: 0.4 }
    writing: { max_tokens: 32768, temperature: 0.7 }
  prompt_cache: true

budgets:
  cold_tokens_max: 6000            # exposed tool-schema budget (§11)
  monthly_usd_max: 200
  per_turn_usd_max: 0.50

observability:
  otel: { endpoint: http://otel-collector:4318 }   # collector fans out to SigNoz + Langfuse
  langfuse: { host: https://langfuse.h12o.io, public_key: ${...}, secret_key: ${...} }
  logs: { pii: false }

channels:
  telegram: { enabled: true, token: ${VAULT:...}, owner_id: ${...} }
  imessage: { enabled: true, bridge_url: http://host.docker.internal:1234 }

notify:                            # outbound alert delivery via the homelab webhook (§16.4)
  webhook_url: https://api.h12o.io/api/notify
  token: ${VAULT:secret/services/agent-kit#notify_webhook_token}   # → Authorization: Bearer
  default_channels: [telegram]     # connectors (telegram/gmail/slack/imessage) live in api-h12o

bundles:                           # stable tool bundles the router selects (§10.1)
  web:      { tier: standard }
  comms:    { tier: fast }
  home:     { tier: fast }
  memory:   { tier: fast }

skills:
  youtube-dvr:          { enabled: true, bundle: web,   tier: trivial,  schedule: "0 * * * *" }
  email-read:           { enabled: true, bundle: comms, tier: fast }
  home-assistant-write: { enabled: true, bundle: home,  tier: fast }

mcp:
  memory: { enabled: true, transport: streamable-http, url: http://localhost/mcp,
            allowed_hosts: [localhost], footprint_budget_tokens: 1200 }
```

**Validation.** Each block + registry entry is decoded with Effect Schema at
boot. Invalid *optional* sections disable their feature + emit one error event
(OTel→SigNoz); an invalid *core* section (store/llm) fails fast.
`/config/reload` hot-applies where safe (schedules, budgets, routing) and reports
what needs a restart.

**Last-known-good safety net (from OpenClaw — the one piece of its config
apparatus worth keeping).** On every successful boot, snapshot the config as
`last-known-good`. If a subsequent edit or `/config/reload` fails validation,
**recover from the snapshot** and alert, rather than wedging the process. We take
*only* this safety net — not OpenClaw's JSON5 journal / optimistic-concurrency
machinery. **The snapshot is the pre-interpolation source** (with `${VAULT:…}` /
`${ENV}` placeholders intact) — never the resolved config, or we'd write live
secrets to disk. Migrations normalize legacy shapes at the edge (a `doctor` pass);
the hot path only ever sees the current canonical shape.

**Secret lifecycle.** `${VAULT:…}` is resolved at load by a short-lived Vault
token (AppRole, TTL ≈ boot window) obtained at deploy, not a long-lived static
secret; static per-service secrets that *can't* be Vault-sourced land in the
sealed env and are rotated by the deploy job. Resolved secret values live only in
process memory, never in the snapshot, logs, or memory rows (§19).

**Hot reload vs in-flight turns.** A turn/job **captures a config snapshot when
its `TurnCtx` is created** (§4); `/config/reload` validates, promotes
last-known-good, and swaps the process-level config reference. In-flight turns
keep the config they started with; new turns pick up the new one — so a mid-turn
tier/budget change can't produce unattributable behavior.

---

## 6. The registry pattern

Everything pluggable is a **Registrable** with a standard manifest and a
**required-config contract** — skills, MCP servers, plugins, agents, channels,
schedulers.

```ts
import type * as Context from "effect/Context";
import type * as Schema from "effect/Schema";

type Tier = "utility" | "trivial" | "fast" | "standard" | "deep";  // COST/CAPABILITY tier
// `utility` = the model the runtime uses for its own meta-calls (summaries,
// classification, observer digests); the rest are task tiers a turn may request. §9
interface Profile {                                       // TASK SHAPE, orthogonal to tier
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly preferredModel?: string;    // pin a model if the tier default won't do
}

interface Manifest<Cfg = unknown> {
  readonly id: string;                  // stable, unique, kebab-case (naming rules: §26)
  readonly kind: "skill" | "mcp" | "plugin" | "agent" | "channel" | "scheduler";
  readonly version: string;
  readonly configSchema: Schema.Decoder<Cfg>; // REQUIRED — decodes its config block
  readonly requires?: Context.Key<unknown, unknown>[]; // declared DI dependencies
  readonly defaultTier?: Tier;
  readonly defaultProfile?: Profile;
  readonly bundle?: string;             // which tool bundle its tools join (§10.1)
  readonly capabilities?: string[];     // e.g. ["reads:email","writes:none"]
  readonly trust?: "read" | "write" | "internal";  // §16 boundary
  readonly footprint?: FootprintHints;  // declared cold-cost hints (§11)
}

interface Registrable<Cfg = unknown> {
  readonly manifest: Manifest<Cfg>;
  activate(ctx: ActivateCtx<Cfg>): Promise<Active>;   // lazy: only if enabled && config valid
}

interface Active {
  readonly tools?: ToolDef[];           // contributed to the tool registry / a bundle
  readonly writeTools?: ToolDef[];      // guarded, separate registry (§16)
  readonly schedules?: ScheduleSpec[];  // cron entries (§15)
  readonly promptFragment?: PromptFragment; // system-prompt contribution (measured)
  readonly hooks?: LifecycleHooks;      // plugin hooks (§8)
  stop?(): Promise<void>;
}
```

Note the **tier/profile split** (a review fix): `Tier` is cost/capability;
`Profile` is task shape. "Writing an article" is `tier: standard` + `profile:
writing` (big `maxTokens`), **not** a `writing` tier — the two were conflated.

**Standard required config values** (merged from defaults): `enabled`, `tier`,
optional `profile`, optional `budget`, optional `footprint_budget_tokens`. The
registry refuses to activate a registrable whose config fails `configSchema` — a
missing-`models[]`-style boot crash (oslo #30) becomes a validation error.

**Config-gated, lazy activation.** At boot the registry only *indexes* manifests
+ validates config; it does not `activate()`. Activation is lazy: a skill's tools
materialize when its bundle is first selected; an MCP connects on first use (or
eagerly if `preconnect: true`). Disabled → never activated.

**Amendments (CAPABILITIES-TDD):** enablement is **opt-in** — a registrable is
enabled iff its config block says `enabled: true` (a pre-staged block no longer
activates anything). The manifest additionally carries `provides` (capability
provider declarations with mandatory distinct traits), `secrets` (declared
names; values supplied only via the registrable's own config `secrets:` block,
never inherited), and a load-bearing semver `version` — the registry resolves
one version per id against an optional config `version:` range pin, shadowing
the rest.

**Manifest-before-code (from OpenClaw).** A manifest is **inspectable without
executing the registrable's code** — everything the registry needs to validate,
enable/disable, and inventory (`id`, `configSchema`, `requires`, `contracts`)
must be cheap static metadata. At activation the manifest's declared `contracts`
(the tools/channels it claims to own) are **cross-checked against what it
actually registers**; a claimed-but-unregistered tool, or two registrables
claiming the same tool, is rejected at startup. This is what lets `doctor`, the
footprint report, and config validation run without importing untrusted plugins.

---

## 7. Core abstractions

### 7.1 LLM gateway (`core/llm`)
Reimplemented from scratch, extended for cost accounting + caching.
- Raw `fetch` to the LiteLLM OpenAI-compatible endpoint; `streamTurn` (SSE,
  `stream_options.include_usage`), `complete`, `embed`. No vendor SDK.
- **Per-key concurrency semaphore** (`withGate`, default `max_parallel-1`).
- **Retry:** transient (network/429/≥500) backoff on non-streaming; per-round on
  streaming.
- **Native constrained decoding** for structured output (schema-as-tool, single
  pass) is the default; prose→JSON is the fallback for models without it (§10.3).
- **Prompt caching, done correctly.** The Anthropic cache prefix is ordered
  `tools → system → messages`. **If the tools array varies per turn, the whole
  prefix busts.** So the cached prefix holds only stable **bundles** + the
  search meta-tool + the persona system prompt; long-tail retrieved tools arrive
  as *message content after the breakpoint* (§10). The ledger tracks cached vs
  uncached input tokens per component.
- `StreamTurnResult` carries `ttftMs`, `totalMs`, `responseModel`, `usage
  {input, output, cached, total}` — raw material for §11/§12.

### 7.2 Tool (`core/agent`)
- `ToolDef {name, description, parameters, execute}`; `execute` →
  `Effect.Effect<string, ToolError>`; the dispatch layer serializes failures as
  `{"error": …}` strings for the model.
- `define(spec)` — Effect Schema is the source of truth; JSON Schema is derived
  with `Schema.toJsonSchemaDocument`, and args are decoded before `run`.
  Descriptions come from disk YAML.
- Each tool is tagged with its owning registrable id and bundle → attribution.

**Tool-description conventions (house style).** How a tool is *described* to the
model is load-bearing — it drives both selection (§10.1) and correct use — and
it's counted as cold tokens (§11), so descriptions are terse by mandate. Modeled
on production tool specs (e.g. Claude Code's grep/glob tools). Every description:
- **Leads with a one-line "when to use / prefer over X"** positioning line, then
  a ~40–60-word *why*; the schema carries the *how*.
- **States when NOT to use it** and the common-error clarifications ("ripgrep,
  not grep — escape literal braces") — mis-selection is a wasted round.
- **Uses enums for constrained choices** and documents **context-dependent
  params** explicitly ("ignored unless `output_mode: content`") so the model
  can't silently misfire.
- **Documents defaults** and keeps each param to one terse sentence.
- Lives in disk YAML (git-authoritative, §12.2), not inlined — editable without
  a rebuild and diffable when the self-improvement loop proposes a wording change.
A `defineTool` lint check flags descriptions over a token ceiling or missing the
when-to-use line, so the conventions are enforced, not aspirational.

### 7.3 Agent loop (`core/agent/run-agent`)
- Immutable-message tail recursion; `tool_choice:auto`, last round forced `none`
  + wrap-up; **intra-round tool calls run concurrently**; `roundsExhausted`
  surfaced; mid-run `takeSteering`.
- `maxRounds` per agent (chat 8, deep 24) from config; `wrapModelCall` threaded
  for observability.
- **Steering placement (message-order correctness).** Anthropic requires the
  `tool_result` blocks to immediately follow their assistant `tool_use` turn.
  Steering inputs (a user message or an observer report, §13) are appended
  **after the complete tool-result block**, never interleaved between a
  `tool_use` and its result — the same tool-pair invariant compaction obeys
  (§10.4). Steering is drained at round boundaries only.
- **Steering channel semantics:** a **bounded FIFO** per turn (cap ~8;
  overflow drops oldest with a metric); **drain-all** at each round boundary
  (all pending steering joins the next round, preserving arrival order); never
  drained mid-round.

### 7.4 Memory (`core/memory`)
mem0-style over Postgres/pgvector. Injected `embed` + `extractFacts` ports.
Collections: `episodic`, `semantic`, `learnings`, `inner`. Recall = one shared
query embedding → **filtered ANN** across collections (k=5, threshold 0.3);
remember = `looksFactBearing` gate → extract → dedupe (0.95 cosine) → upsert.
- **Provenance / trust column (a review fix).** Every fact row stores `origin`
  (`owner` | `internal` | `untrusted`) plus `embed_model_id` + `dim`.
  **Write-agent recall filters to `origin IN (owner, internal)`** — an injected
  "fact" from an email/iMessage body can never resurface later as trusted context.
  - **Mixed-provenance turns:** a fact's `origin` = the **minimum trust of any
    source in its extraction context**; a turn mixing an owner message and an
    untrusted email body extracts as `untrusted`. **The §10.4 compaction summary
    obeys the same rule** — it's written to memory, so a summary over untrusted
    content is itself `untrusted` (otherwise the injection-across-time hole
    reopens through summarization).
  - **Dedupe is partitioned by origin.** The 0.95-cosine dedupe runs *within*
    `origin`, never across — else an injected near-duplicate could suppress or
    mask a trusted fact. An `owner` restatement of an `untrusted` fact writes a
    **new `owner` row** (an upgrade), it doesn't merge into the untrusted one.
- **Filtered ANN correctness (item):** an ANN index + a `WHERE origin=…` filter
  over-fetches or loses recall by default — enable pgvector 0.8
  **`hnsw.iterative_scan = relaxed_order`** (or the diskann equivalent) in store
  setup, or the provenance filter silently returns too few rows.
- **Vector type is an M0 risk (see §3/§23.2):** `pgvectorscale`'s StreamingDiskANN
  historically indexes `vector`, not `halfvec` (it does its own SBQ quantization
  internally). If `halfvec`+diskann doesn't index, fall back to `vector`+diskann
  (its internal quantization still gets the RAM win) or `halfvec`+HNSW. Decide in
  the M0 spike, not at scale.
- PII boundary: ≤200-char previews, no raw transcripts.
- **Lifecycle (from hermes's memory manager):** **prefetch before the turn**
  (recall on the inbound message while the persona assembles) and **sync after
  the turn** (extract + upsert), the sync running async on a bounded drain
  timeout so a wedged memory backend never blocks a reply. **One external memory
  provider at a time** (our pgvector store is the provider) — multiple backends
  bloat the tool schema and conflict; keep it single.

### 7.5 MCP client (`core/mcp`)
Hand-rolled Streamable-HTTP/SSE/stdio JSON-RPC client. `connect` → `initialize`
→ `tools/list`; persistent session; `call(name, args)`. DNS-rebinding allowlist
headers (oslo lesson).

---

## 8. The three extension patterns

All three are registrables (§6); they differ in what they contribute.

- **8.1 Skill** — the unit of capability: **tools (joining a bundle) + optional
  schedule + optional prompt fragment + config contract + cost profile**. The
  primary way to add a feature. `youtube-dvr` contributes a `youtube` tool to the
  `web` bundle and an hourly schedule. Shape (validated by hermes + OpenClaw, both
  converged on markdown-frontmatter skills):
  - **A skill is a `SKILL.md`**: YAML frontmatter decoded with Effect Schema + a
    prose/command **body loaded lazily** (only when the skill fires), never at
    boot. Optional `references/`, `scripts/`, `templates/`.
  - **`requires: { bins?, env?, config? }` eligibility** (+ `os?`) — the concrete
    form of §6's required-config contract. A skill whose prereqs are absent is
    **filtered out of the prompt entirely** (not shown-then-erroring), evaluated
    against an eligibility context (local / remote / exec). Optional `install[]`
    lets a skill self-describe how to satisfy a missing CLI dep (brew/node/uv/…).
  - **Three independent exposure flags** — `inRuntimeRegistry` (the model may call
    it), `inPromptCatalog` (it appears in the compact skills snapshot), and
    `userInvocable` (a human `/slash` may call it). These are orthogonal: a skill
    can be model-callable but hidden, or human-only.
  - **Progressive disclosure ladder:** a category `DESCRIPTION.md` (one-line
    blurb) → a compact `skills_list` snapshot in the prompt → `skill_view` loads
    the full body on demand. The prompt-facing snapshot is versioned so a format
    change busts caches deterministically.
- **8.2 MCP server** — tools come from `tools/list`; connects lazily; **measures
  the cold-token cost of its schemas at connect** and enforces
  `footprint_budget_tokens`. Over budget → logged/metered and routed behind the
  search meta-tool (long tail) rather than pinned into a bundle. Down MCP →
  circuit-broken, its tools drop out, turn degrades.
- **8.3 Plugin / extension** — hooks the runtime lifecycle and can register
  skills/MCPs/channels. **Manifest-before-code (adopted from OpenClaw):** a
  plugin's manifest (`id`, `configSchema`, and a **`contracts`** block declaring
  which tools/channels it owns) is **inspectable without executing plugin code** —
  so config validation, a `doctor` inventory, and enable/disable work without
  importing untrusted plugins. At load, declared `contracts.tools` are
  **cross-checked against actual `registerTool` calls**; a plugin that claims a
  tool it never registers, or a duplicate owner, is **rejected at startup**. The
  manifest's `configSchema` is an inspectable Effect Schema value; each plugin's
  `register(api)` receives only its **own decoded config slice**
  (`api.pluginConfig`), never the whole config. Ordered middleware (onion):

```ts
interface LifecycleHooks {
  onBoot?(get: ServiceGet): Promise<void>;
  onTurnStart?(t: TurnCtx): Promise<void | TurnCtx>;
  selectBundles?(t: TurnCtx, all: BundleIndex): Promise<string[]>;      // custom router
  beforeModelResolve?(t: TurnCtx): Promise<ModelChoice | void>;         // §9 routing seam
  onModelCall?(info: ModelCallInfo, next: () => Promise<R>): Promise<R>;
  beforeToolCall?(c: ToolCall): Promise<"allow" | "block" | "require_approval">; // §16
  onToolCall?(call: ToolCall, next: () => Promise<string>): Promise<string>;
  onTurnEnd?(t: TurnResult): Promise<void>;
  onSchedule?(job: JobCtx): Promise<void>;
}
```

- **8.4 Capability contract (CAPABILITIES-TDD §3)** — a versioned interface
  (`<id>@<major>`, Effect Schema input/output) with **config-selected
  providers**. Skills whose functionality overlaps must register as providers
  of a shared contract and differ on declared traits (machine-checked); callers
  invoke the *capability* through one bus (validated both sides, fallback on
  retryable failure, unconfigured → a uniform `{mode:"unavailable"}` degrade)
  instead of hard-wiring a concrete tool. Calls carry a **call chain**
  (`agentkit.chain` span attr; embedded in every capability error) with
  depth/cycle caps — the GitHub-reusable-workflows analogy
  (inputs/outputs/secrets/`uses`/run-graph) is deliberate.

`onModelCall(info, next)` **is the single model-call wrap seam** — the same thing
earlier prose called `WrapModelCall`; there is one name (`onModelCall`) and one
signature, and observability (§12) is just its first consumer. Hook contract
(from OpenClaw's mature hook bus): **decision-returning hooks run sequentially by
descending priority with a per-hook timeout budget; observation hooks run in
parallel.** Shipped as plugins: injection screen (§16), footprint accountant
(§11), self-improvement observer (§13), approval gate, background-investigate.
Keeping these as plugins (not loop branches) keeps the loop small and each
measurable.

---

## 9. Model routing: tier + profile (the pattern)

**Code names a *tier*; config maps tier→model. A *profile* rides orthogonally.**
Code never names a model; it names a `tier` (cost/capability) and optionally a
`profile` (task shape: `maxTokens`/`temperature`/`preferredModel`). Swapping a
model is a one-line YAML edit.

- `llm.models` (§5) is the tier→model table; `llm.profiles` is the profile table.
- Each registrable declares `defaultTier` (+ optional `defaultProfile`); config
  overrides both. A turn resolves `model = models[tier]`, decode params =
  `profiles[profile]`.
- Escalation is tier-typed: `deep_investigate` → `deep`; structured reformatting
  → `fast`/`trivial`; persona filler → `trivial` ($0 local route).
- Per-turn dynamic routing (optional plugin): a deterministic classifier bumps
  tier and/or selects `profile: writing` (larger `maxTokens`) for a message —
  without touching base wiring. This is why "writing" is a profile, not a tier.

**Refinements adopted from OpenClaw's model layer:**
- **A `utility` tier for internal meta-calls** — titles, classification,
  summarization (§10.4), the observer digest — routed to a dedicated cheap model
  so framework overhead never burns the primary tier. (Distinct from `trivial`,
  which is a task tier a *turn* can request; `utility` is what the runtime itself
  uses.)
- **Auth-failover before model-failover.** On an auth error, rotate credentials
  *within* the provider before falling to the next model in the chain — a
  transient key problem shouldn't silently downgrade the model.
- **Strict for explicit choice, fallback for defaults.** An explicit user/skill
  model pin resolves **exactly or fails loudly** (no silent downgrade);
  configured defaults use the full tier→fallback chain. A `modelPolicy.allow`
  wildcard allowlist (`anthropic/*`) is a §16 guardrail on what may be routed to.

---

## 10. Token efficiency

### 10.1 Tool disclosure that doesn't fight the cache (the #1 review fix)
Progressive per-tool disclosure and prompt caching are in direct tension: the
cache prefix is `tools → system → messages`, so **a tools array that varies per
turn invalidates the entire prefix every turn** — stable *ordering* of a varying
set doesn't save it. Resolution, two complementary mechanisms:

1. **Toolset bundles (primary).** Cluster tools into ~6–10 **stable** bundles
   (`web`, `comms`, `home`, `security`, `memory`, `ops`). The router selects
   *bundles*, not individual tools. That yields a small number of cache
   *variants* (one warm prefix per common bundle combination) instead of an
   unbounded set, and bundles stay warm because usage is Zipfian. Bundle
   membership is declared on the manifest (`bundle:`).
   - **Deterministic serialization (cache correctness).** Selecting `{web,comms}`
     and `{comms,web}` **must** produce a byte-identical prefix, so bundles
     serialize in a **fixed global order** (a declared bundle ordinal) regardless
     of selection order, and tools within a bundle in a fixed order. **Cap
     concurrent bundles at ~3** so the cache-variant space stays small (3 of ~8
     bundles = a bounded, mostly-warm set).
2. **Tool-search + a dispatcher meta-tool (long tail).** Two tools sit **in the
   cached prefix**: `search_tools(query)` (returns candidate tool *descriptions*)
   and a generic **`invoke_tool(name, args_json)`** dispatcher. The **`tools`
   array is immutable per session** — long-tail tools are *never* added to it
   (that would bust the prefix, the exact thing this section prevents). The model
   discovers a tool via `search_tools`, then calls it through `invoke_tool`.
   Because the model never gets constrained decoding for a dispatched tool,
   **`invoke_tool` decodes `args_json` against the real Effect Schema
   server-side** before calling `run(name,args)` — same validation path as a
   first-class tool, just enforced by us instead of the provider. One extra
   round on a cold topic; prefix stays immutable.

**Bundles first, dispatcher for the long tail; measure both with the §11
harness** — this is its first real use.

**The router runs off the network critical path (review fix).** Embedding the
turn via LiteLLM before building the request adds a full RTT to TTFT (~30–80 ms),
dwarfing the 10 ms deltas §11 exists to detect. Instead:
- **Static in-process embeddings** (model2vec / fastembed — sub-ms, no network,
  ~30 MB), tool/bundle-description vectors **precomputed at registration**.
- **BM25 first, vectors as tiebreak.** Tool descriptions are keyword-dense
  ("send", "email", "lock", "playlist"); Postgres FTS (or ParadeDB `pg_search`)
  fused with the static-embedding cosine via **reciprocal rank fusion** beats
  pure cosine and costs nothing extra (same store).

**Implementation decisions lifted from hermes-agent's `tool_search` (prior art
that converged on this exact design — adopt near-verbatim):**
- **Never defer core tools.** Memory/delegate/notify/ask stay in the cached
  prefix unconditionally. "Always-load means always-load, no exceptions."
- **Threshold-gated activation.** Disclosure engages only when *deferrable*
  (MCP + non-core) tool schemas exceed ~**10% of the context window**, or a fixed
  **~20K-token** cutoff when the window is unknown (the empirical cliff above
  which quality drops). Below threshold, expose everything — don't pay the extra
  round for nothing.
- **Stateless rebuild every turn.** The searchable catalog is rebuilt from the
  live tool list each assembly, never a session-keyed cache — this is precisely
  the OpenClaw "catalog drifts → silent tool dropouts" regression we're avoiding.
- **BM25 search blob = `name` (split snake/dot/kebab into words) + description +
  top-level param names**; schema bodies excluded (noise, no recall gain). A
  **substring fallback** covers zero-IDF queries (`github` when every tool is
  `github_*`).
- **Bridge through the same dispatch.** `invoke_tool` routes the call back through
  the *same* `run(name,args)` path so guardrails, approval, and truncation fire
  identically; **unwrap the bridge** in traces/UI so logs show the real tool, not
  the dispatcher shim.
- **`bundle_non_core_tools` delta (a bug we'd otherwise hit).** Disabling a
  bundle must subtract only its *non-core* tools — subtracting the whole bundle
  strips shared core tools that other bundles rely on and can hand the model an
  empty tool array. Bundle math is set-difference over the non-core delta, never
  the full membership.

### 10.2 Prompt caching
Stable prefix = persona system prompt + selected bundles + search meta-tool,
`cache_control` on the breakpoint. **Optional keep-warm:** a cheap scheduled
no-op turn on a short cron holds the shared prefix hot so interactive turns ride
a warm cache — worth it only if idle-cache-miss TTFT actually bites; measure
before adding it.

### 10.3 Structured output
**Native constrained decoding (schema-as-tool, one pass) is the default** — no
double round trip, no extra hallucination surface. Prose→JSON reformatting is
the fallback only when a model lacks constrained decoding or the schema is huge.

### 10.4 Context budget & compaction
Recall previews ≤200 chars; tool outputs capped (`max_output`); evidence trails
reference ids, not pasted blobs. History compaction is the load-bearing part, and
gets the hermes-agent treatment (adopt — the correctness details are non-obvious):
- **Protect head + tail, summarize the middle.** Keep the first system/user turns
  and the last N turns; the compressible region is between them, sized by a token
  budget (not a fixed message count).
- **Tool-pair boundary-snapping (correctness, not polish).** A compaction cut must
  **never land between a `tool_call` and its `tool_result`** — that orphans the
  result and the provider rejects the message list. Snap the boundary forward
  (preferred) then backward to a clean turn edge.
- **Structured summary via a cheap aux model** (§9 `utility` tier, temp ~0.3),
  prefixed `[CONTEXT SUMMARY]`, with a **Resolved / Pending** template and
  "historical (reference-only)" headings so the summary doesn't read as active
  instructions. Pre-prune verbose tool outputs *before* the summarize call.
  **Iterative carry-forward:** each compaction updates the prior summary rather
  than starting over, so information survives repeated compactions.
- **Rotate the session id on compaction** so old/new histories split cleanly and
  memory/observers are notified; the summary is written to memory with
  `origin`-provenance (§7.4).
- **Startup feasibility probe:** verify the aux model's context window can fit the
  compaction threshold; auto-lower or hard-fail if not.

Every mechanism is measured (§11).

---

## 11. Performance & footprint accounting (marquee)

*"Adding this MCP increased response time by 10 ms and cold token usage by xyz."*
Made a first-class, automatic output.

### 11.1 What we attribute
- **Static (cold) footprint — known at registration/connect, no traffic.** The
  number that answers "how much does *installing* this cost every turn it's
  exposed":
  - `schema_tokens` + `prompt_tokens` = `cold_tokens`, computed with a **local
    tokenizer** (**not** a network call to LiteLLM `/utils/token_counter`),
    **cached keyed by schema hash** so an unchanged schema is never recounted.
    **Caveat:** `gpt-tokenizer`/tiktoken is OpenAI BPE; Anthropic tokenization
    differs 10–20%. That's fine for **deltas** (a consistent bias cancels), but
    wrong for **absolute budgets** — so treat `cold_tokens` as *relative units*
    for ranking/regression, and derive `budgets.cold_tokens_max` enforcement from
    a **per-provider calibration factor** measured once at boot (compare the local
    count of a known prefix against the provider's real `usage.input_tokens`).
  - `init_ms` from traced lazy registrable activation (§4/§6).
- **Dynamic footprint — an *estimate*, attributed via spans.** A round runs
  several tools concurrently (§7.3), so there's no clean causal split of the
  round's `usage` delta. We **label it an estimate, apportioned by tool-output
  byte share**, and lean on the §11.2 A/B harness for anything a decision hangs
  on. Aggregated per component/day: `calls`, `p50/p95 tool_ms`,
  `attributed_*_tokens (est.)`, `attributed_usd (est.)`, `error_rate`,
  `cache_hit_rate`.
- **Cardinality guard:** `{model × component × cached}` on counters/histograms
  hurts SigNoz once there are ~300 tools — cap component-level metric cardinality
  (top-N components + an "other" bucket; keep full detail in the pg ledger).

Ledger lives in Postgres (partitioned / Timescale); exposed at `GET /footprint`
+ a SigNoz dashboard.

### 11.2 The delta measurement
- **Cold-token delta is direct** — it *is* the component's `cold_tokens`.
- **Latency/quality delta** comes from the eval harness: replay a golden dataset
  **enabled vs disabled** → Δp50/Δp95 TTFT, Δtotal, Δcost, Δquality. "Enabling
  `web` MCP: +9 ms p50, +1,180 cold tokens, +$0.002/turn, quality +0.4." The
  online (estimated) ledger fills the gap between runs.
- **Degradation testing (adapt hermes's toolset sampling — eval-only).** The
  harness can **randomly sample tool subsets** across runs to test how the agent
  behaves when tools are missing. This belongs in `testkit`, never the runtime —
  probabilistic tool availability in production is non-determinism users don't want.

### 11.3 Two gates, not one (review fix)
Replaying a golden dataset through live models on every PR is nondeterministic
and costs money — so it wouldn't actually run. Split it:

| Gate | When | Cost | Deterministic |
| --- | --- | --- | --- |
| **Footprint gate** — cold tokens, schema size, `init_ms`, budget ceilings | **every PR** | **$0, no LLM calls** | **yes** |
| **Quality gate** — golden dataset, judges, Δp50 | nightly + pre-release | real (Batch API, −50%) | no |

Cold-token regression is a pure static computation over registered schemas — no
model needed. Making it free is what makes it run on every PR (the whole point).
The nightly quality gate and the §13 reflection agent both run through the
**Batch API** (latency-irrelevant, half price). **Runtime guardrails:** per-turn
USD cap, monthly kill-switch, footprint-anomaly alert.

---

## 12. Observability

**One OTel pipeline, two sinks.** A single tracer → one OTLP exporter → an **OTel
Collector** that fans out to **SigNoz** (traces/metrics/logs/exceptions) and
**Langfuse** (which now ingests OTLP). One instrumentation path, consistent trace
IDs across both sinks, and swapping a backend is a collector-config change.
**No Sentry** (nor the `@sentry/*` SDK); SigNoz owns error/exception tracking and
liveness. GlitchTip (Sentry-protocol) is an *optional, operator-side* sink only.

### 12.1 OTel → SigNoz
- **Spans:** a turn = `gen_ai.invoke_agent`; each round = `gen_ai.chat`
  (`request.model`, `response.model`, `finish_reasons`,
  `usage.{input,output,cached,total}_tokens`); each tool =
  `gen_ai.execute_tool` tagged `agentkit.component.id`. Jobs/schedules/MCP/memory
  are spans too.
- **Metrics:** token counters, cost gauges, latency histograms (TTFT/total/
  per-tool), tool-call/error counters, cache-hit ratio, queue depth, scheduler
  lag, footprint gauges, router bundle-selection + budget utilization — subject
  to the §11.1 cardinality cap.
- **Resource attrs** in bracket form for dotted keys (oslo lesson):
  `service.name=agent-kit`, `deployment.environment`, `host.name`.
- **Liveness:** channel-socket heartbeat + scheduler check-ins.
- **Content-free telemetry hooks (from OpenClaw).** The observability lifecycle
  hooks (`model_call_started/ended`) carry **timing, outcome, and bounded
  request-id hashes only — never prompt or response content** — so telemetry is
  privacy-preserving by construction and can't leak PII into a span. Payload
  inspection stays in the PII-boundaried memory/trace path, not the metric bus.

### 12.2 Langfuse — traces/scores/datasets/annotation (not prompts)
**Prompts are git-authoritative (§13), not fetched from Langfuse** — one source
of truth, and "which prompt actually ran" is answerable from a commit. Langfuse
is used for:

| Langfuse feature | agent-kit use |
| --- | --- |
| Traces / generations / sessions | every turn/job = a trace (via OTLP); `sessionId` = conversation key; usage + cost per round. |
| Scores + score configs | every turn scored: heuristic (rounds-exhausted, retries, gate-fires, latency, cost, correction) + LLM-as-judge. |
| Evaluators + evaluation rules | server-side judges on sampled traces (helpfulness, injection-resistance, tool-correctness). |
| Datasets + runs / experiments | the golden set for the §11 quality gate + §13 A/B; footprint deltas as experiment runs. |
| Annotation queues | low-scoring/flagged turns → human review → dataset items. |
| Dashboards / models / monitors / media | cost/latency/quality dashboards; per-model pricing; drift alerts; camera frames as trace media. |

> **Infra note:** self-hosted Langfuse v3 wants Postgres + ClickHouse + Redis +
> S3 — a lot of homelab for what we use. It's already running for oslo; we ride
> it, but we do **not** put agent-kit's store on its Postgres (§3).

---

## 13. Self-improvement loop

Two loops at two timescales: a **real-time observer** that catches a mistake
*before it compounds*, and a **nightly reflection** that changes behavior — the
latter only through a git PR gate.

**Signals (continuous).** Every `onTurnEnd`/`onSchedule` emits scores, retries,
`roundsExhausted`, approval-gate fires, tool errors, user corrections,
latency/cost, footprint deltas → learnings store + Langfuse scores.

**Observer (real-time, in-turn, `fast`/`trivial` tier).** A background oversight
agent paired with an active turn, modeled on production observer prompts (Claude
Code's `observer`). It consumes a **read-only digest** of the turn's tool calls,
tool results, and steps — it does *not* participate — and **stays silent by
default**: the expected steady state is no output. It speaks only on one of three
triggers: a **compounding mistake** (an error about to cascade), a **missed
constraint** (an ignored requirement — including a trust-boundary or budget
violation), or **relevant prior art** (a memory/learning the turn should see). It
reports via a dedicated `observer_report` tool (not general messaging), and the
report is delivered as a **steering injection** (§7.3 `takeSteering`) into the
turn's next round — so the correction lands mid-turn, not in a postmortem. Cheap
by construction (mostly silent, low tier); the sparse, high-confidence bias is
the whole point — a chatty observer is worse than none. It proposes nothing
durable; that's the nightly loop's job.

**Observer safety invariants (adopted from hermes-agent's forked-review design —
these are what make an in-turn self-critic safe):**
- **Forked, isolated context.** The observer runs on a *snapshot* of the turn; it
  **never mutates the live session or the prompt cache**. Its only side effect is
  the `observer_report` steering injection.
- **Reuse the warm cache.** Keep the observer on the **same model** as the turn so
  its replay hits the same prefix cache (near-free cached reads); if it must run
  on a cheaper model, send it a **compact digest**, not the full replay, to
  minimize cold-written tokens.
- **Tool-restricted.** The observer's allowlist is memory/skill reads only —
  everything else denied — so it cannot act on the world, only advise.
- **Late report policy.** The observer is async, so an `observer_report` may land
  after the turn has already ended (no next round to steer). If so it is **dropped
  from the live path** (the silence bias makes a delayed interruption worse than
  none) and instead written to the **learnings store** for the nightly loop — it
  is **never** surfaced to the user as an after-the-fact postmortem message.

**Reflection (nightly, Batch API, `deep` tier).** A scheduled agent scans the
day's traces/scores, clusters recurring problems, emits **typed proposals** —
routing bumps (config diff), prompt rewrites (a new prompt file), tool pruning
("`stripe_refund_list` exposed 400×, never called → drop, save ~180 cold
tokens"), memory facts, and **new skills scaffolded by a `skill-creator`
meta-skill** (a skill whose job is authoring skills from the §8.1 manifest schema,
so agent-authored skills are schema-valid by construction). Reflection is
**inactivity-triggered** (fire when idle and last-run > interval), not a rigid
cron, so it never interrupts active work. Skill maintenance **archives, never
deletes** (recoverable), touches **only agent-created skills**, and **respects
pins** (a pinned skill bypasses all auto-transitions). It runs on the Batch API
(nightly Opus over a day of traces is the single most expensive line item and has
zero latency requirement).

**Gate (never blind self-modification).** Each proposal becomes:
1. A **dataset A/B** via testkit (golden set, proposed change) — proceed only if
   quality holds/improves and §11 budgets pass.
2. **A git PR** — for prompts *and* config alike (prompts are versioned files, so
   a prompt change is just a diff). Human approves → merge → deploy. This is the
   single gate and single source of truth; there is no separate "flip a Langfuse
   label" path.
3. **Rollback:** every applied change is tagged; an online-ledger regression
   auto-proposes a revert.

Both loops are themselves measured and gated — the observer changes nothing
durable, the reflection changes nothing without an A/B + a human PR — so there's
no unobserved drift, and no observer-with-no-observer regress.

---

## 14. Background agents & the job system

The interactive turn must never block on minutes-long work. Postgres makes this
mostly a matter of using the right primitive rather than hand-rolling.

- **Queue in Postgres.** Claim with `BEGIN; SELECT … FOR UPDATE SKIP LOCKED …
  RETURNING; COMMIT`; a `lease_expires_at` column + `LISTEN/NOTIFY` wakes workers
  instead of **fast** polling. `SKIP LOCKED` is the most battle-tested queue
  primitive there is. Rows: `{id, kind, payload, priority, status, attempts,
  lease_expires_at, idempotency_key, origin_conversation}`.
- **NOTIFY is a latency optimization, not durability.** `LISTEN` can't ride a
  pooled connection (recycling drops the subscription), and a `NOTIFY` fired while
  a worker is down is gone. So: **one long-lived dedicated connection for
  `LISTEN`** with reconnect logic, **plus a slow (~30 s) poll sweep** as the
  durability backstop. NOTIFY makes the common case instant; the sweep guarantees
  nothing is stranded.
- **Worker pool** (concurrency-capped, shares the LLM gate) runs background
  agents on their own tier/budget. Connection-pool sizing is explicit (§20).
- **Delegation is a tool.** `delegate(task, {tier, deadline})` enqueues a
  **subagent with an isolated context** and returns an immediate ack ("on it,
  back shortly — don't call again"); the result posts into the originating
  conversation + history.
- **Kanban coordination for multi-step delegations (from hermes).** When one
  request fans out to several workers, they coordinate through a small **kanban
  tool surface** rather than ad-hoc chatter: a worker **marks a task done with a
  structured handoff**, can **block for human input**, and **heartbeats during
  long ops** (so a stalled worker is detectable, not just silent). Structured
  handoffs keep the envelope trust model (§16) intact between agents.
- **Edge cases:** at-least-once + `idempotency_key`; crash recovery = expired
  leases reclaimed by the next `SKIP LOCKED` scan; **inbound dedupe on Telegram
  `update_id` / iMessage GUID** (a duplicate delivery is not a new job);
  backpressure (bounded queue, shed lowest priority); poison quarantine after N
  attempts; per-origin fairness.

---

## 15. Scheduler

- **Durable cron** persisted in Postgres with `next_fire`.
- **Single-owner via `pg_advisory_lock`.**
  `pg_try_advisory_lock(hashtextextended('sched:telegram-poll', 0))` — only one
  process ever owns a given poll, across restarts and deploys; fixes the oslo
  `fribbles_bot` 409 duplicate-poller bug. Three gotchas the doc must pin: (i) the
  lock is **session-scoped** — it must be held on a **dedicated, non-pooled
  connection** (a pooled connection recycling silently releases it), with a
  liveness check on that connection; release-on-death is free (Postgres session
  teardown drops it). (ii) use **`hashtextextended`** for the full 64-bit
  keyspace, not `hash()`. (iii) advisory-lock keys share **one global bigint
  namespace** — prefix a component discriminator (`sched:`, `poll:`) so unrelated
  subsystems can't collide.
- **Catch-up policy** per schedule: `skip` (default) or `catchup` (one fire per
  missed window). Handles restarts. **Clock skew / DST** across a restart is
  handled by a real cron/tz library computing `next_fire` from wall-clock ET, not
  shell date math (oslo `busybox date -d` bug) and not naive interval addition.
- **Liveness:** each run wraps a SigNoz check-in (heartbeat metric + alert rule).
- Scheduled runs reuse the interactive "assemble persona → runAgent → deliver →
  file facts" body (one code path).
- **`[SILENT]` sentinel (from hermes routines).** A scheduled job that returns the
  `[SILENT]` sentinel produces **no notification** — so a poller alerts only on a
  real change, not every tick. This is what makes a 2-minute or hourly job
  non-annoying by default.
- **Script pre-pass.** A job may declare a `--script` that runs *before* the
  agent turn; its stdout is **injected as context**. Mechanical/deterministic
  work (fetch, parse, diff) runs in code; only the reasoning runs in the model —
  cheaper and more reliable than asking the model to do the mechanical part.
- Per-job **model tier + skill set + delivery target** (which notify channel,
  §16.4) are job config.

---

## 16. Channels & the trust boundary

**Channels** (Telegram/Slack/iMessage/HTTP/internal) are `kind:channel`
registrables: inbound → normalized `Inbound`, plus delivery. Telegram primary;
iMessage via BlueBubbles read-only query (`POST /message/query`, not `GET /chat`).

**Read/write trust boundary (enforced by the runtime):**
- **Ingress injection screen** (plugin, generalizing oslo `llm-monitor`):
  untrusted inbound (email/iMessage/camera/web) screened before the loop —
  Layer-1 heuristics + optional Layer-2 cheap classifier. HIGH → block;
  MEDIUM+confirm → block; else pass/flag; fails open for low confidence but tags
  the message `origin: untrusted`.
- **Read agents hold no write tools.** `trust: "read"` manifests output only
  validated JSON envelopes; the registry refuses them `writeTools`.
- **Untrusted-surface bundle (from hermes `_HERMES_WEBHOOK_SAFE_TOOLS`).** Any
  turn triggered by injection-exposed input — a public webhook, a scraped page,
  unsolicited inbound — is pinned to a constrained, **read-only tool bundle**
  (search / extract / vision / clarify; no writes, no exec, no delegation). The
  injection screen sets `origin: untrusted`; the router then selects *only* the
  safe bundle for that turn, so even a successful prompt injection has no
  dangerous tool to reach.
- **Envelope handoff.** Effect Schema-decoded envelopes carry `_meta` (agent
  chain, trace/session ids) + `confirmed`/`owner_approved` (both must be exactly
  `true`). Write agents never see raw untrusted content.
- **Writes are a separate registry behind an approval gate** — model loop never
  holds real write executes; a write stages behind a Telegram Approve/Deny button
  (10-min timeout). **Bind the approval to the action (confused-deputy fix):** the
  callback must verify (a) sender == `owner_id`, (b) a **single-use nonce bound to
  a hash of the staged action payload**, (c) not expired. Without the payload-hash
  binding, a stale or replayed callback approves whatever happens to be staged
  now. Approve → the button handler (the only caller) runs the real execute.
- **Provenance closes the time-axis hole (review fix).** The `origin` tag rides
  from ingress → into memory rows (§7.4); write-agent recall excludes
  `origin: untrusted`. The boundary was airtight in the request path and porous
  through time; now both are closed.
- **Irreversible actions** (refill place-order, HA lock/alarm) gated by an
  explicit dry-run-default config flag + the approval button.

### 16.4 Outbound alert delivery — the homelab notify webhook (not an agent)
`notify` is not an LLM agent; alert delivery is a plain HTTP call to the homelab's
existing channel-agnostic notify API. agent-kit already runs an HTTP server (the
Hono ingress, §3) — delivery is the *outbound* side of that.

- **`NotifyPort.send({ body, channels?, subject?, to? })`** → `POST
  https://api.h12o.io/api/notify` (LAN-only via Traefik → spruce `172.16.20.21:
  18090`; `Authorization: Bearer ${notify_webhook_token}`). agent-kit holds only
  that one token; **per-channel secrets and connectors
  (telegram/gmail/slack/imessage) live in `api-h12o`**, resolved from Vault
  (`${vault:services/oslo#…}`). Adding a channel is a YAML file in api-h12o, not
  an agent-kit change.
- **Trust property preserved without an agent:** the framework passes only `body`
  (+ an allow-listed `channel`); it **never forwards a recipient (`to`) taken
  from untrusted JSON** — destination defaults live in the api-h12o connector, so
  an injected `chat_id` can't redirect a notification. `dryRun:true` previews.
- **Exposed to agents** as a single `notify` tool (in the `comms` bundle) and
  used directly by the runtime for scheduled/skill alert fan-out.
- **Inbound events (optional):** the same HTTP server can receive homelab events —
  either subscribe to `api.h12o.io` `WS /ws/events` (topics like `github.push`)
  or accept forwards from `trailhead` (the public webhook receiver → `POST
  /api/events`) — to trigger turns/jobs. This is how a webhook becomes an agent
  trigger without agent-kit facing the public internet.

---

## 17. The fleet — how the consumer maps its features onto agent-kit

**These live in the consumer (`agent-oslo`), not agent-kit.** The table proves
the primitives suffice — each feature is a registrable (or a read/write pair).
The **read/write split is the model** (§16): a capability earns its own *agent*
only when it ingests untrusted content (read) or performs a gated mutation
(write); everything else is a *skill*. `notify` is **not** an agent — alert
delivery is a call to the homelab notify webhook (§16.4). `breaking-news` is
dropped. Note `persona from git prompt`, not Langfuse.

| Feature | Kind(s) | Trust | Tier | Trigger | Notes |
| --- | --- | --- | --- | --- | --- |
| `main` | agent (persona/orchestrator) | internal | fast → deep | interactive | front door; calls skills directly, hands off to read/write agents across the trust boundary; persona = git prompt asset. |
| `imessage-read` | **read agent** | read | fast (local) | poll/bridge | classify → envelope; `origin:untrusted`; **no send tools**. |
| `imessage-write` | **write agent** | write | fast | envelope / owner cmd | send only on `confirmed && owner_approved`; gated. |
| `email-read` | **read agent** | read | fast | cron `0 6:45` + `/email` | classify + suggest archive/unsubscribe; envelope out; no write tools. |
| `email-write` | **write agent** | write | fast | envelope | archive/unsubscribe execute behind the approval gate. |
| `home-assistant-write` | **write agent** | write (semi) | fast → standard | owner cmd | HA REST; lock/alarm behind confirmation. |
| `security` | **read agent** | read | standard (vision) | cron + motion | frames → vision via LiteLLM → `SECURITY_EVENT`; frames as trace media; deleted post-analysis. |
| `briefing` | **skill** | internal | standard | cron `0 7` | composes spend + email digest; delivers via the notify webhook. |
| `youtube-dvr` | **skill** | internal | trivial | cron `0 *` | new uploads → dated playlist; a pipeline, no agent identity. |
| *(alert delivery)* | infra, not an agent | — | — | any | POST to `api.h12o.io/api/notify` (§16.4). |

~6 agent identities (main + 3 read + 3 write, with imessage/email as pairs), a
couple of scheduled skills, and delivery-as-infra — instead of one-agent-per-
feature, which would fragment the prompt cache and multiply per-task model calls.

Shared infra: registry + bundle router (§10), memory (§7.4), scheduler (§15),
jobs (§14), observability (§12), trust boundary (§16). None reimplements a runtime.

---

## 18. Web & browser capability

A clean-room general-purpose pack; SEO-specific providers excluded (§25).

- **`agent-browser`** — token-efficient automation (Rust daemon + CDP; ref-based
  `@e1` snapshots, ~85–90% fewer tokens than raw DOM). **The stateless client
  speaks HTTP to the `agent-browser` daemon *container* (§3), not a local
  socket** — Chromium is out of the runtime image. Per-agent `--session`,
  `--json`, `--max-output`, `--allowed-domains`. Tools:
  `browser_open/read/snapshot/click/fill/press/get/wait/console/close`. The
  headed-Playwright-under-Xvfb fallback (pharmacy refill, a consumer skill) also
  lives in the browser container — no Xvfb in the main image.
- **Daemon auth + downloads (don't leave these open).** The runtime→daemon HTTP
  call carries a **Vault-sourced bearer token** — otherwise anything on the Docker
  network can drive a logged-in Chromium session. **Downloads are disabled by
  default**; when a skill needs them they land on a scratch volume the runtime
  treats as **untrusted input** (`origin: untrusted`, §16). Left unspecified this
  is an unmonitored exfil/ingress path.
- **Search:** **Brave** (`brave_search`) + **Firecrawl** (`firecrawl_search`,
  `firecrawl_scrape` → markdown) + a generic `webpage` fetcher (non-2xx is data).
  No SEO/SERP-analytics providers.
- All are read tools in the `web` bundle; subject to disclosure + footprint
  accounting.

---

## 19. Security & secrets

- **Secrets** Vault → sealed per-service env at deploy → resolved via
  `${VAULT:…}` / `${ENV}`. Least privilege; never inlined, never logged, redacted
  before memory writes.
- **Browser isolation (the real reason it's a separate container).** Chromium is
  the one component that runs untrusted content by design; its container gets its
  own egress allowlist, **no network route to Postgres or the control API**, and
  its own resource limits (a Chromium OOM degrades browsing, not the agent).
- **Runtime hardening:** `no-new-privileges`, drop `NET_RAW`/`NET_ADMIN`,
  read-only assets, non-root.
- **Trust boundary** (§16) is the primary application-security control.
- **Kill switches:** monthly/per-turn budget caps + a global pause halting
  channels + schedulers.

---

## 20. Edge cases & failure modes (consolidated)

| Case | Handling |
| --- | --- |
| **Postgres unavailable at boot** | Core dependency (§5) → fail fast, clear error, supervisor won't mark ready. |
| **Postgres unavailable at runtime** | Memory + jobs + scheduler degrade (best-effort); interactive chat still replies from history-in-request; alerts fire. |
| **Connection-pool exhaustion** | Bounded pool (`store.pool.max`); jobs queue on the pool; `statement_timeout` + `lock_timeout` set; pool-wait metric alerts. |
| Cold start latency | Warm caches at boot; an optional cheap keep-warm cron holds the prompt-cache prefix hot (§10.2). |
| Tool-schema bloat as skills grow | Bundles bound exposed schemas; long tail behind the search meta-tool; cold-token budget enforced (§10/§11). |
| MCP server down | Lazy connect + circuit breaker; tools drop out; turn degrades. |
| Prompt injection (request path) | Ingress screen + read/write boundary + envelope revalidation (§16). |
| **Prompt injection (across time)** | Memory `origin` provenance; write-agent recall excludes `untrusted` (§7.4/§16). |
| Gateway 429 / burst | Client-side semaphore + transient retry. |
| Background job crash/restart | `SKIP LOCKED` + lease expiry reclaim; idempotency keys; poison quarantine (§14). |
| Scheduler missed tick / **clock skew / DST** across restart | Durable `next_fire` from wall-clock ET via a real tz lib; per-schedule catch-up (§15). |
| Duplicate poller (two processes) | `pg_advisory_lock` single-owner (§15). |
| **Duplicate messages** | Dedupe on Telegram `update_id` / iMessage GUID (§14). |
| **Embedding-model change** | `embed_model_id`+`dim` per row; dual-write + background reindex (§3/§7.4). |
| **Disk full on /data (Postgres volume)** | Monitored; WAL archiving + `pg_dump` to MinIO; alert before saturation; backpressure jobs. |
| **The volume dies** | `pg_dump` + WAL archive → MinIO = point-in-time recovery (§3). |
| **Chromium zombie processes** | Isolated in the browser container with its own limits + reaper; daemon restart doesn't touch the runtime. |
| Config error at boot | Optional section disables + 1 error event (SigNoz); core section fails fast (§5). |
| Token budget exhausted mid-turn | `roundsExhausted` surfaced; not presented as a conclusion. |
| Self-improvement drift | A/B + git-PR gate + tagged rollback (§13). |
| Two messages, same conversation | Mid-run steering; history append serialized. |
| Cost runaway | Per-turn + monthly caps, footprint anomaly alert, global pause. |
| Secret leakage in logs/memory | Pre-write redactor; content out of logs; ≤200-char previews. |
| Camera/vision PII | Frames analyzed then deleted; only descriptions persisted; frames as trace media. |
| **LiteLLM gateway down** | The single point of failure for anything interactive. Retry only within the transient budget, then **fail the turn with a clear channel-delivered error** — never retry into a dead gateway; scheduled jobs re-lease later. |
| **Channel delivery limits** | Outbound **chunking + per-channel entity escaping** (Telegram 4096-char, markdown) is a **channel-adapter contract** — the adapter splits/escapes, the loop emits plain text. |
| **Interactive flood (spammed chat)** | Per-origin fairness covers jobs; interactive adds a **per-conversation debounce + queue-depth cap** so one chat can't monopolize the gate. |
| **Clock authority** | Scheduler `next_fire` and job `lease_expires_at` compare against **Postgres `now()`**, never container wall-clock — clock drift across nodes/restarts is otherwise a silent lease/fire bug. |
| **Graceful shutdown mid-turn** | Supervisor drain: in-flight **turns get N seconds to finish the current round + deliver**; leased jobs are abandoned to lease reclaim (already covered); then stop. |
| **Effect Schema→JSON Schema derivation edge cases** | Unions/records/top-level `anyOf` produce schemas some providers reject — the **free static footprint gate (§11.3) also lints every derived schema against provider constraints** (already static, already per-PR). |
| **`update_id` / GUID dedupe storage** | A `processed_inbound(channel, external_id)` table with a TTL index (or reuse the jobs `idempotency_key` unique index) — one, named, not ad-hoc. |

---

## 21. Repo & package layout

> **Packaging: two separate repos** (decided). `~/code/agent-kit` and
> `~/code/agent-oslo`, one-way dependency (`agent-oslo → agent-kit`), with §24's
> boundary enforced by a lint rule (`dependency-cruiser` /
> `eslint-plugin-boundaries`) — "a change requiring an agent-kit edit to add an
> oslo feature is a design smell." agent-kit publishes its packages (or is
> consumed via a pinned git ref / local link); agent-oslo consumes them.

```
agent-kit (framework workspace / repo)
  packages/
    core/          # llm/agent/mcp/memory  (ports only, no product coupling)
    host/          # bootstrap·config·registry·runtime·router·scheduler·jobs·footprint·observability·self-improve·trust
    channels/      # telegram·slack·imessage(bluebubbles)·http adapters
    skills/web/    # generic web pack: agent-browser(HTTP client)·brave·firecrawl·webpage·sitemap·page-audit
    skills/watch/  # observe→diff→trend→outcomes over any metric-rows@1 provider (CAPABILITIES-TDD §9.2)
    skills/ops/    # spike triage·alert hygiene·self-guard (CAPABILITIES-TDD §9.3)
    skills/email/  # gmail inbox triage·read/write·follow-up judgment
    skills/github/ # draft_pr write-tool → reviewable draft PRs, provides change-proposal@1 (CAPABILITIES-TDD §9.4)
    skills/reminders/ # durable one-shot "remind me at …" over the job queue
    plugins/       # injection-screen·approval-gate(+variants)·background-investigate·footprint-accountant·self-improve·observer
    integrations/  # OPTIONAL opt-in clients (http core·google-auth·github·gmail·home-assistant·mcp) — NO tmh/SEO (§25)
    store/         # pg pool, migrations runner, pgvector/pgvectorscale, ledger, queue
    testkit/       # eval harness + footprint-gate runner (datasets supplied by consumers)
  Dockerfile.base      # bun runtime ONLY (no Chromium)
  Dockerfile.browser   # Chromium + agent-browser daemon (+ Xvfb/Playwright fallback)

agent-oslo (consumer workspace / repo)  — depends on agent-kit
  src/main.ts     # composition root: import agent-kit, register fleet, start supervisor
  src/fleet/      # the fleet as registrables (agents split read/write + scheduled skills)
  config/         # agent-oslo.yaml + {prod,dev}   (enable/route/schedule/budgets)
  assets/         # persona prompts + tool descriptions (git-authoritative)
  env/ env.d/     # Vault → sealed per-service env (secrets)
  eval/           # oslo golden datasets (→ agent-kit/testkit)
  deploy/         # compose (agent-kit + postgres + agent-browser), deploy/watchdog scripts
```

---

## 22. Build order (milestones)

1. **M0 — spine.** Effect Layer/ManagedRuntime + supervisor + config load/validate
   (+ last-known-good, §5) + **Postgres store with a migrations runner + DDL
   (§27.1)** + `/healthz` + control-route authz (§3). **Definition of done retires
   the three empirical risks:** (i) the **Bun/OTel span-propagation spike**
   (§3/§23.1); (ii) the **`pgvectorscale` + `halfvec` + iterative-scan** check
   (§7.4/§23.2) — pick the working vector-type/index combo here; (iii) a **backup
   *restore* test** (`pg_dump`/WAL → MinIO → restore into a scratch db) — a backup
   never restored isn't a backup. Prove lazy resolution + correct nested spans in
   SigNoz before anything agentic.
2. **M1 — the loop.** `core/llm` (gate, retry, cache, constrained decoding) +
   `core/agent` + Telegram + `main`. A traced chat turn.
3. **M2 — registry + bundles.** Manifest/config-gating + the **bundle router**
   (static embeddings + pg FTS, RRF) + search meta-tool + web pack + memory
   (with `origin` provenance). Caching-safe disclosure working.
4. **M3 — observability + footprint.** One OTel pipeline → collector → SigNoz +
   Langfuse; ledger + `/footprint` + testkit; **the free static footprint gate**
   in CI.
5. **M4 — async.** Scheduler (`pg_advisory_lock`, catch-up) + job system
   (`SKIP LOCKED`, `LISTEN/NOTIFY`) + `delegate` + background-investigate.
6. **M5 — trust boundary.** Injection screen, read/write split, approval gate,
   envelope handoff, provenance-filtered recall.
7. **M6 — self-improvement.** Scores/evaluators/annotation + the real-time
   observer (silence-biased, steering-injected) + nightly (Batch-API) reflection
   + git-PR gate + A/B + the nightly quality gate.
8. **M7 — `agent-oslo`.** Build the fleet on the stable framework:
   persona/config/assets → scheduled skills (briefing, youtube-dvr) → the
   read/write agents (imessage, email, home-assistant-write, security) → wire the notify
   webhook → deploy (three containers). agent-kit gets no oslo-specific code.

---

## 23. Decisions to confirm

1. **Runtime: Bun vs Node 22.** Recommending **Bun**, but the real risk is
   OTel/`AsyncLocalStorage` span propagation, not "a Node-only lib." **The M0
   spike decides it** — if nested spans don't come out right in SigNoz, Node 22.
2. **Store: Postgres + pgvector/pgvectorscale** (recommended, decided by the
   review). Risk is now "one stateful sidecar to operate" + an **empirical vector
   combo** to lock down in M0: `pgvectorscale`/StreamingDiskANN historically
   indexes `vector`, not `halfvec`, and filtered ANN needs
   `hnsw.iterative_scan=relaxed_order`. Fallback order if `halfvec`+diskann fails:
   `vector`+diskann (internal SBQ quantization still wins RAM), else `halfvec`+HNSW.
   Fine to start plain-pgvector and add pgvectorscale when episodic grows.
3. **Container count: 3 (recommended) vs 2** (fold the browser into the runtime).
   3 buys the browser security isolation (§19); 2 is simpler to operate. Never 1.
4. **Language for skills.** All-TypeScript (recommended); Python-only skills run
   as `delegate`d subprocess jobs, not in-process.
5. **DI ergonomics.** `Context.Service` keys + an explicit application `Layer`
   owned by one `ManagedRuntime`; no reflection (implemented).
6. **Cold-token budget hardness.** Warn-and-route-behind-search (recommended) vs
   hard-refuse-to-register when an MCP blows its budget.
7. **Repo packaging — DECIDED: two separate repos** (`agent-kit`,
   `agent-oslo`), one-way dependency, boundary lint-enforced. (The review floated
   one-repo/two-workspaces to avoid publish friction; keeping two repos per your
   call — the friction is a `changesets`/pinned-ref concern, not a blocker.)
8. **Self-improvement autonomy.** Propose-only, human-gated via git PR
   (recommended) vs auto-apply for a whitelisted low-risk class (e.g. tool
   pruning) after a passing A/B.

---

## 24. Repo boundary — what goes where (authoritative)

**agent-kit is generic; agent-oslo is opinionated.** If a thing names oslo, names
a person, holds a secret, or encodes one operator's taste → agent-oslo. If it'd
be identical for a second consumer (`agent-work`, `agent-lab`) → agent-kit. This
holds whether packaging is two repos or two workspaces (§23.7); it's enforced by
a lint boundary, not a publish pipeline.

| Concern | `agent-kit` | `agent-oslo` |
| --- | --- | --- |
| Agent loop, registry, bundle router, DI, supervisor | ✅ owns | consumes |
| Config **loader/validator/schema types** | ✅ owns | — |
| Config **values** (enables, budgets, schedules, tier/model table) | — | ✅ owns (YAML) |
| Tier→model routing **mechanism** | ✅ owns | supplies the table |
| Channel adapters | ✅ owns | enables + tokens |
| Web/browser pack | ✅ owns | enables |
| Postgres store, memory, scheduler, jobs, footprint ledger, self-improve engine | ✅ owns | consumes |
| Trust-boundary primitives (screen, envelope, approval gate, provenance) | ✅ owns | builds read/write agents on |
| Observability wiring (OTel pipeline, collector fan-out) | ✅ owns | supplies endpoints/keys |
| Alert delivery | ✅ owns the `NotifyPort` + tool | supplies webhook URL/token; connectors live in external `api-h12o` |
| Eval harness + gates | ✅ owns | supplies **datasets** |
| Reusable integration clients (Gmail/HA/GitHub/MCP) | ✅ owns (opt-in) | wires + credentials |
| Persona / prompts / voice | — | ✅ owns (git assets) |
| The fleet (agents split read/write + skills) | — | ✅ owns (`fleet/`) |
| Secrets, Vault paths, sealed env | — | ✅ owns |
| Deployment (compose: 3 containers, scripts) | ships base + browser **images** | ✅ owns the deploy |
| Golden datasets, alert thresholds, dollar budgets | — | ✅ owns |

Dependency is one-way: `agent-oslo → agent-kit`. A change that would require
editing agent-kit to add an oslo feature is a design smell — generalize the
extension seam instead. (Lint rule, not a registry.)

---

## 25. Deliberately excluded (tmh / SEO-specific) capabilities

**Keep (generic → agent-kit):** `agent-browser`, Brave, Firecrawl, `webpage`,
the MCP client, the memory engine, and (opt-in) GitHub + Home Assistant + Gmail +
BlueBubbles integration clients.

**Drop — SEO-specific (kathleen):** DataForSEO (SERP/keywords/backlinks/
AI-Overview — explicitly not needed), Google Search Console, PageSpeed Insights,
GA4, and the entire `seo/` skill pack + SEO vocabulary router.

**Drop — tmh product / infra-specific:** Firestore, Firebase Auth / magic-link /
`user_lookup`, PostHog, Mixpanel, SendGrid, **Sentry (SDK + tool)**, dan's
customer-ops digests + the fix-PR-as-customer-support framing (*the generic
anchored-edit → gated-PR mechanism is kept, but only for §13 self-improvement*),
and the Slack social layer (peer banter, pop-ins, commute gripe — dan/kathleen
personality theater; the consumer keeps one lightweight `main` persona).

**Kept but relocated to the consumer:** persona/day-state mood generation — the
engine hook is in agent-kit, the persona content is oslo's (git assets).

---

## 26. Naming conventions (authoritative)

A **feature is a registrable** (§6/§8) — a skill, an MCP, a plugin, or a
read/write agent pair (§17). Each one introduces a fixed set of named things, and
each named thing has exactly one case style and one shape. This section is the
single source so two features never disagree; it's enforced where possible by the
manifest Effect Schema contract (§6) and the `defineTool` lint (§7.2).

### 26.1 Case style by kind (the table)

| Named thing | Case | Shape | Examples |
| --- | --- | --- | --- |
| Registrable **`id`** (the "feature name") | `kebab-case` | `<domain>[-<qualifier>]` | `youtube-dvr`, `email-read`, `home-assistant-write`, `security` |
| **Bundle** | `lower` (closed set) | one short noun | `web`, `comms`, `home`, `security`, `memory`, `ops` |
| **Tool** name | `snake_case` | `<namespace>_<verb>` / `<verb>_<object>` | `browser_open`, `firecrawl_scrape`, `search_tools`, `notify` |
| **Config block** key | = the `id` | mirrors the registry | `skills.youtube-dvr`, `mcp.memory` |
| **Config field** | `snake_case` | noun | `footprint_budget_tokens`, `allowed_domains` |
| **Envelope / event** type | `UPPER_SNAKE` | `<DOMAIN>_<EVENT>` | `SECURITY_EVENT`, `NETWORK_ALERT` |
| **Capability** tag | `lower` | `<verb>:<object>` | `reads:email`, `writes:none` |
| **Tier / profile / trust / origin** | `lower` (enum) | closed word | `fast`, `writing`, `read`, `untrusted` |
| **Memory collection** | `lower` | singular-ish noun | `episodic`, `semantic`, `learnings`, `inner` |
| **Schedule / job** `kind` | `kebab-case` | reuse the `id` | `youtube-dvr`, `email-read` |
| **Prompt / tool-desc asset** | path from `id` / namespace | `assets/…` | `assets/prompts/main.md`, `assets/tools/browser.yaml` |
| **OTel component attr** | — | `agentkit.component.id` = the `id` | `agentkit.component.id=email-read` |
| **TS** type / value | `PascalCase` / `camelCase` | standard | `ToolDef`, `runAgent` |

The split is deliberate: **kebab** for disk/config/registry identity, **snake**
for model-facing tool names (matches OpenAI tool-name norms and the reference
tool specs), **UPPER_SNAKE** for envelope event types, standard TS casing for
code symbols.

### 26.2 The feature `id` — what people mean by "the feature name"

- **kebab-case, singular, stable, globally unique.** It is simultaneously the
  registry key, the config block key, the metric label (`agentkit.component.id`,
  §12.1), the schedule/job `kind`, and the asset-path stem. **Renaming it is a
  migration** — pick well once.
- **`<domain>` first** — a capability noun (`email`, `home`, `youtube-dvr`),
  never a person, a secret, or the word `agent`/`skill`. The `kind` field already
  says what it is: `email-read`, **not** `email-read-agent`.
- **The read/write trust split uses the reserved suffixes `-read` / `-write`**
  (§16). A capability that both ingests untrusted content *and* mutates state is
  **two** registrables sharing a domain stem — `email-read` + `email-write` —
  never one `email` holding both tool sets. This is the naming face of the
  §16 boundary.
- **Sub-areas take a short-noun qualifier suffix** — e.g. were `security` ever
  split, `security-home` / `security-net` — in preference to minting a new
  top-level domain.
- **Reserved:** `main` (the front-door persona/orchestrator, §17) — one per
  consumer.

### 26.3 Tool names

- **snake_case, namespaced by owner** so a bundle's tools cluster and read as a
  set: `browser_open/read/snapshot/click/fill/press/get/wait/console/close`,
  `brave_search`, `firecrawl_scrape`. The namespace is the **subsystem or
  provider**, not the registrable `id`.
- Shape is **`<namespace>_<verb>`** or **`<verb>_<object>`**; a bare verb is
  allowed only for a genuine singleton (`notify`, `delegate`).
- Terse and model-facing — the *description*, not the name, does the explaining
  (§7.2). The `defineTool` lint rejects a name over the length ceiling or one that
  collides with a name in another bundle.

### 26.4 Bundles

- A **closed, curated vocabulary.** Bundles are cache variants (§10.1), so their
  count is bounded on purpose — adding one is an architecture decision, not a
  per-feature convenience. Current set: `web`, `comms`, `home`, `security`,
  `memory`, `ops`.
- A feature **joins** an existing bundle via `manifest.bundle`; it does **not**
  coin its own. The long tail lives behind the search meta-tool, not in a
  one-feature bundle.

### 26.5 What one feature names (checklist)

Adding a feature, you choose at most:

1. the **`id`** (§26.2) — `<domain>[-read|-write|-<subarea>]`, kebab-case;
2. its **tools** (§26.3) — `<namespace>_<verb>`, all sharing one namespace;
3. its **bundle** — *pick* from §26.4, don't invent;
4. its **config key** — *is* the `id`; fields inside are snake_case;
5. any **envelope/event type** it emits — `UPPER_SNAKE`, `<DOMAIN>_<EVENT>`;
6. its **schedule/job `kind`** (if any) — reuse the `id`;
7. its **asset files** — `assets/prompts/<id>.md`, `assets/tools/<namespace>.yaml`.

Everything else it touches — `tier`, `profile`, `trust`, `origin` — is a **value
from a closed enum**, never a new name.

### 26.6 Capability-layer names (amendment — CAPABILITIES-TDD §10)

Capability refs are kebab + `@major` (`page-fetch@1`); traits are single lower
kebab tokens (`free`, `api-key`); secret names are `snake_case`; new pack dirs
are `skills-<domain>`; a coexisting major lives at `<skill>.v<N>.ts` exporting
the **same id**; chain hops render as `<kind>:<ref>` from a closed kind enum.

---

## 27. Appendices (implementation sketches)

Enough detail that M0–M2 are mechanical. Sketches, not final — but the shapes,
indexes, and wire formats are the ones to build.

### 27.1 Store DDL (sketch)
Postgres. Every vector column is `origin`-filterable; every ANN index assumes
`hnsw.iterative_scan=relaxed_order` (§7.4). `now()` is Postgres's, not the app's.

```sql
-- memory: episodic/semantic/learnings/inner share one table, partitioned by collection
CREATE TABLE memory (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  collection   text     NOT NULL,          -- episodic|semantic|learnings|inner
  origin       text     NOT NULL,          -- owner|internal|untrusted  (§7.4)
  embed_model  text     NOT NULL,          -- provenance for reindex
  dim          int      NOT NULL,
  embedding    vector   NOT NULL,          -- or halfvec pending M0 (§23.2)
  preview      text     NOT NULL,          -- ≤200 chars, PII-bounded
  body_ref     text,                       -- pointer, not the raw transcript
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
) PARTITION BY LIST (collection);
CREATE INDEX ON memory USING diskann (embedding) WHERE origin IN ('owner','internal');
CREATE INDEX ON memory (collection, origin);
-- dedupe is per (collection, origin) at write time (§7.4), not a constraint

CREATE TABLE history (              -- durable conversation history (§7.3)
  conversation_key text NOT NULL,   -- channel or channel:thread
  seq          bigint NOT NULL,
  role         text   NOT NULL,
  content      jsonb  NOT NULL,     -- message blocks incl. tool_use/tool_result
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_key, seq)
);

CREATE TABLE jobs (                  -- §14 queue
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind           text NOT NULL,
  payload        jsonb NOT NULL,
  priority       int  NOT NULL DEFAULT 100,
  status         text NOT NULL DEFAULT 'ready',      -- ready|leased|done|dead
  attempts       int  NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  idempotency_key  text UNIQUE,                       -- also the dedupe surface
  origin_conversation text,
  run_after      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON jobs (status, priority, run_after)   -- the SKIP LOCKED claim index
  WHERE status = 'ready';

CREATE TABLE schedule (              -- §15 durable cron
  id          text PRIMARY KEY,      -- = registrable id
  cron        text NOT NULL,
  next_fire   timestamptz NOT NULL,
  catchup     text NOT NULL DEFAULT 'skip',           -- skip|catchup
  last_fired  timestamptz
);
CREATE INDEX ON schedule (next_fire);

CREATE TABLE processed_inbound (     -- §14 dedupe (Telegram update_id / iMessage GUID)
  channel     text NOT NULL,
  external_id text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, external_id)
);                                    -- TTL-reaped (e.g. daily delete < now()-interval)

CREATE TABLE footprint_ledger (      -- §11 time series (partition by day / Timescale hypertable)
  ts           timestamptz NOT NULL DEFAULT now(),
  component_id text NOT NULL,
  cold_tokens  int,
  calls        int,
  tool_ms_p50  int, tool_ms_p95 int,
  in_tokens_est bigint, out_tokens_est bigint, usd_est numeric,
  cache_read_tokens bigint, cache_write_tokens bigint   -- §27.5 per-provider mapping
) PARTITION BY RANGE (ts);
```

### 27.2 Envelope schema (the trust-boundary wire format, §16)
```ts
import * as Schema from "effect/Schema";

const Envelope = Schema.Struct({
  kind: Schema.String, // e.g. SECURITY_EVENT, EMAIL_SUMMARY
  origin: Schema.Literals(["owner", "internal", "untrusted"]),
  payload: Schema.Record(Schema.String, Schema.Unknown),
  confirmed: Schema.Boolean, // both booleans must be exactly `true` to act
  owner_approved: Schema.Boolean,
  _meta: Schema.Struct({
    agent_chain: Schema.Array(Schema.String), // read→…→write provenance
    trace_id: Schema.String, // W3C, propagates the OTel trace (§12)
    session_id: Schema.String,
    issued_at: Schema.String, // ISO; stamped by the emitter
    parent_trace_id: Schema.optional(Schema.String),
  }),
});
// A write agent decodes payload against the kind's own Schema before acting.
```

### 27.3 Tagged error taxonomy (§1 "errors are values")
One top-level union; each carries `{ _tag, message, retryable }`.

| Tag | Retryable? | Origin |
| --- | --- | --- |
| `ConfigError` | no (fail fast / disable section) | §5 validation |
| `StoreError` | **transient**: yes (backoff); constraint: no | Postgres |
| `LlmError` (`http`/`network`/`protocol`) | 429/5xx/network: yes; 4xx: no | §7.1 gateway |
| `ToolError` | tool-defined; default no | §7.2 tool exec |
| `McpError` | connect: yes (circuit-broken); call: no | §7.5 |
| `ChannelError` | delivery 5xx/limit: yes (chunk/retry); auth: no | §16 adapters |
| `BudgetExceeded` | no (hard stop) | §11 guardrails |
| `MemoryError` | yes, best-effort (degrade, never block) | §7.4 |

Retryable errors go through the transient-retry + concurrency gate (§7.1);
non-retryable surface immediately. Handled typed-channel errors that would
otherwise be invisible are force-emitted to SigNoz (§12).

### 27.4 Backup mechanism (§3)
WAL archiving to MinIO via **`pgBackRest`** (or `wal-g`) — a named tool, not
"WAL archiving" in the abstract; `pg_dump` nightly is the coarse belt-and-braces.
**M0 definition of done includes a restore test** (archive → restore into a
scratch db → assert row counts), because a backup never restored isn't a backup.

### 27.5 Cached-token accounting through LiteLLM (§11/§12)
Providers report cache usage under different field names — Anthropic
`cache_read_input_tokens` / `cache_creation_input_tokens`, OpenAI
`cached_tokens` — and LiteLLM's normalization has been inconsistent. The ledger
carries an explicit **per-provider usage-field mapping** (keyed by
`response_model`'s provider prefix) that projects raw usage into
`{input, output, cache_read, cache_write}`; without it the §12.1 cache-hit-rate
metric is quietly wrong for one provider. The mapping is validated once at boot
against a known cached prefix (same probe as the §11.1 tokenizer calibration).
