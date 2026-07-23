# Capability contracts, pack abstraction & versioning — Technical Design

> Status: **rev 1 — implementation companion to ARCHITECTURE.md (extends rev 4).**
> Scope: the clean-room abstraction pass over the three `@tmh` prior-art sources
> (`packages/agents`, `services/seo-agent`, `services/dan-agent`) — utility
> surface only, persona/social/mood explicitly excluded — plus the four framework
> mechanics that pass forced: **capability contracts** (two skills must be
> *different ways* of doing a thing), **declared inputs/outputs/secrets**
> (GitHub-reusable-workflow model), **in-repo versioning**, and **call-chain
> tracing**. Nothing here weakens ARCHITECTURE invariants; where this doc touches
> a numbered section it amends it explicitly (§ refs are ARCHITECTURE.md's).

---

## 1. Prior-art inventory → disposition

Every utility behavior found in the three sources, and where it lands. "Covered"
means agent-kit already owns the pattern; "contract-only" means we ship the
interface but no default provider (the provider is consumer- or milestone-scoped).
Clean-room rule holds throughout: behaviors were re-specified from observation and
reimplemented; no code moved.

### 1.1 From `packages/agents` (the shared kit)

| Prior-art behavior | Disposition |
| --- | --- |
| Effect Schema-first `define` + descriptions from disk + boundary decoding | **Covered** (`core/agent/define.ts`) |
| Read registry vs separate approval-gated write registry | **Covered** (§16; `Active.writeTools`, trust plugins) |
| Registry decorators (`withApprovalGate`, background investigate, `instrumentTools`) | **Covered** (plugin hooks §8.3) |
| Nullable-config-section = feature flag | **Adopted, hardened**: explicit `enabled: true` now required (§5 of this doc) |
| Shared HTTP helper: tagged errors `<service>.<phase>`, retry on 429/5xx, body clipping | **New** → `integrations/http.ts` |
| SDK-free Google SA-JWT minting w/ cached token + expiry skew | **New** → `integrations/google-auth.ts` |
| Client factory shape (`make<Name>`, result-slicing, per-request auth resolution) | **Conventions** (this doc §9.4) + reference client `integrations/github.ts` |
| Anchored-edit application (unique-match-or-abort-all) | **New** → `core/edits.ts` (also feeds §13 self-improvement) |
| Fix-PR pipeline (confidence gate → anchored edits → draft PR) | **Generalized** → `change-proposal@1` capability + GitHub provider |
| Cron/interval monitors, socket heartbeat, boot-failure capture | **Covered/deferred**: §12 owns liveness; boot-failure capture is a deferred host item (§11 below) |
| Composite fan-out tool (`user_lookup` folding per-source errors inline) | **Deferred** (documented pattern; add a helper when a second consumer needs it) |
| Durable JSON-file conversation history (hashed keys, append chain) | **Superseded** by Postgres history (§27.1) |
| Assets loader (YAML/handlebars prompts from disk) | **Deferred** — prompts are git-authoritative (§12.2); a loader lands with M7 consumer work |
| Streaming tool-status label maps | **Dropped** — channel-cosmetic, persona-adjacent |
| LLM concurrency cap under a gateway key | **Covered** (`core/llm/semaphore.ts`) |

### 1.2 From `seo-agent` (all reimplemented domain-generically)

| Prior-art behavior | Disposition |
| --- | --- |
| Snapshot store (dated, atomic write, retention, previous/history) | **New** → `skills/watch` store port |
| Week-over-week diff (improved/declined/new/act-now subsets, `\0` composite keys) | **New** → `skills/watch/diff.ts` |
| Trend: decay (weighted metric sliding over ≥3 snapshots amid activity) + cannibalization (one key split across own series) | **New** → `skills/watch/trend.ts` (as `decaying` / `splitAttribution`) |
| Outcome ledger (baseline at ship-time → soak → verdict → retire) | **New** → `skills/watch/outcomes.ts` |
| Sitemap resolution (robots → sitemap → one-level index) + bounded-concurrency map | **New** → `skills/web/sitemap.ts` |
| Page hygiene extractors (meta/H1/word-count/img/OG/JSON-LD/anchors) + JSON-LD structural validation | **New** → `skills/web/page-audit.ts` (generic checks only; no Google rich-result taxonomy) |
| Draft-PR-only publishing with path fencing + mint-time branch stamps | **Generalized** → `change-proposal@1` (path allowlist is provider config) |
| A/B pattern: draft-first create, prefix-fenced flag keys, re-verify fence before every mutation | **Contract-only** → `experiment@1` + the *fenced-mutation* rule (§9.5); no analytics provider ships (§25) |
| Weekday plan (day→task, every-other-week alternates, rotating list targets) | **New** → `host/scheduler/rota.ts` (pure) |
| Opportunity scoring formula, CTR curve, SERP/backlink providers, GSC/GA4/DataForSEO | **Dropped** — domain-specific (§25) |
| Degraded mode: absent optional dep → `{mode:"unavailable", note}` not an error | **Absorbed by the capability layer** (§4.5) — unconfigured capability degrades identically everywhere |
| Vocabulary-regex model routing | **Deferred** — the §9 `beforeModelResolve` seam already exists; a `route-vocab` plugin is a later milestone |

### 1.3 From `dan-agent`

| Prior-art behavior | Disposition |
| --- | --- |
| Spike triage poll (baseline seed, threshold, seen-set, ignore list, null-vs-empty discipline) | **New** → `skills/ops/spike.ts` |
| Correlating a spike against recent deploys within a time window | **New** → `skills/ops/spike.ts` (`correlateChanges`, generic "recent change events") |
| Alert hygiene: dedupe keys, flap cooldown, state pruning | **New** → `skills/ops/hygiene.ts` |
| Self-alert guard (never chase your own errors) | **New** → `skills/ops/self-guard.ts` |
| Approval-choice **variants** (the approver's click picks the disposition, e.g. refund vs no-refund) | **New** → `plugins/trust/approval-gate.ts` extension |
| Ops pattern: curried ports, production guard chains replayed, audit actor stamp, refund idempotency key | **Conventions** (§9.5); idempotency is already a §14 job primitive; audit stamping folds into the approval gate record |
| Investigation → ticket → confidence-gated draft PR | **Generalized** → `change-proposal@1`; the orchestration stays consumer-side |
| Sentry/Stripe/Firestore/magic-link clients and tools | **Dropped** — product/infra-specific (§25; framework has no Sentry) |

---

## 2. The four framework mechanics (what this design adds)

GitHub reusable workflows are the working analogy throughout:

| GitHub reusable workflows | agent-kit equivalent |
| --- | --- |
| `workflow_call.inputs` (typed, defaults, required) | capability contract `input` Effect Schema decoder |
| `workflow_call.outputs` | capability contract `output` Effect Schema decoder |
| `workflow_call.secrets` (declared; caller must pass) | `manifest.secrets` declarations; values from the registrable's own config `secrets:` block |
| `secrets: inherit` | **prohibited** — see §6.3 |
| `uses: owner/repo/wf.yml@v1` | a capability ref `<id>@<major>`; the *provider* is chosen by config, not by the caller |
| tag/major pinning (`@v1`) | contract majors in the ref; registrable semver + config `version:` range pins |
| 4-level nesting limit | capability chain depth cap (4) + cycle rejection |
| the run graph (which workflow called which, where it failed) | the **call chain**: hops recorded on spans + inside every capability error |

### 2.1 Why a capability layer at all

The prior art grew *two* fetchers, *two* searchers, and *N* per-provider variants
of "get metric rows", with call sites hard-wired to one concrete tool and
hand-rolled "unavailable" fallbacks at every site. The registry already prevents
two skills claiming the same *tool name* — but nothing stops two skills from
being the same *way of doing the same thing*, invisible to config and
unswappable. The capability layer makes overlap first-class: overlapping skills
must declare themselves **providers of a shared, versioned contract**, must
differ on declared **traits**, and get selected/ordered by **config** — so "two
skills provide different ways of doing something" is machine-checked, not
tribal knowledge.

---

## 3. Capability contracts

### 3.1 Contract

```ts
import type * as Schema from "effect/Schema";

interface CapabilityContract<In = unknown, Out = unknown> {
  readonly id: string;          // kebab-case noun(-verb), e.g. "page-fetch"
  readonly major: number;       // interface version; the ref is `${id}@${major}`
  readonly description: string; // one line, model- and human-facing
  readonly input: Schema.Decoder<In>;
  readonly output: Schema.Decoder<Out>;
  /** Dot-paths inside input to redact from chains/spans. */
  readonly redact?: readonly string[];
}
```

A contract is **pure metadata + schemas** — no behavior. Contracts live in a
`ContractCatalog` (host). A breaking change to `input`/`output` mints
`<id>@<major+1>`; both majors may be registered side by side and providers name
the major they implement. Additive-optional input fields are non-breaking.

### 3.2 The standard catalog (shipped, extensible by consumers)

| Ref | Input → Output (abbreviated) | Purpose |
| --- | --- | --- |
| `web-search@1` | `{query, count?}` → `{hits: [{title,url,snippet}]}` | find pages |
| `page-fetch@1` | `{url, maxChars?}` → `{status, content, format}` | read one page |
| `metric-rows@1` | `{days?, filter?}` → `{rows: [{id, series?, metrics}]}` | pull the rows a watch snapshots (provider = consumer's data source) |
| `issue-feed@1` | `{limit?, windowHours?}` → `{items: [{key,title,count,users?,firstSeen?,url?,project?}] \| null}` | unresolved-issue feed for spike triage; `null` = fetch failed (load-bearing, §8.2) |
| `change-feed@1` | `{limit?}` → `{changes: [{ref,title,at,url?,ok}]}` | recent deploys/changes to correlate spikes against |
| `change-proposal@1` | `{title, body?, branchSuffix, edits[], creates[]}` → `{url, ref, note}` | stage a reviewed change; **never merges** |
| `experiment@1` | `{action: propose\|status\|decide, …}` → `{…}` | draft-first experiments; **contract-only**, no shipped provider |

### 3.3 Providers

A registrable declares what it provides in the **manifest** (static,
inspectable — manifest-before-code §6 holds):

```ts
interface ProviderDecl {
  readonly capability: string;          // "page-fetch@1"
  readonly traits: readonly string[];   // non-empty, kebab tokens — the differentiation axes
}
// Manifest gains:  readonly provides?: readonly ProviderDecl[];
```

and returns the implementation from `activate()`:

```ts
interface ProviderImpl {
  readonly capability: string;
  invoke(input: unknown, ctx: CapabilityCtx): Promise<unknown>; // validated by the bus on both sides
}
// Active gains:  readonly providers?: readonly ProviderImpl[];
```

**The distinct-traits rule (the differentiation pattern).** At index time, for
each capability ref, the enabled providers' trait sets must be pairwise
distinct (set equality, order-insensitive). Two enabled providers with identical
traits = "the same way twice": the later registrant is **disabled with one
error event** (same posture as invalid config §5 — degrade, don't crash), naming
both ids and the rule. Traits are also the vocabulary config uses to prefer a
provider without naming one. Recommended axes (open vocabulary, keep terse):
cost (`free`/`metered`), fidelity (`raw`/`readable`/`js-render`), dependency
(`api-key`/`local`), freshness, side (`remote`/`in-process`).

Declaring a capability that isn't in the catalog, or trait-less `provides`,
disables the registrable with an error event.

### 3.4 Selection is config, and nothing is on by default

```yaml
capabilities:
  page-fetch@1:  { provider: firecrawl, fallback: [webpage] }
  web-search@1:  { provider: brave }
  metric-rows@1: { provider: my-metrics-source }
```

- **No entry for a ref → the capability is unavailable.** Consistent with the
  opt-in posture (§5): installing a pack enables nothing.
- `provider` must name an *enabled* registrable declaring that ref; `fallback`
  is an ordered list tried on **retryable** failure (network/429/5xx-shaped),
  never on validation failure (bad input fails identically everywhere).
- Selection is per-ref (per major), so a consumer can run `page-fetch@1` on one
  provider and `page-fetch@2` on another during a migration.

### 3.5 The bus

`CapabilityBus.invoke(ref, input, ctx)` — the one path every capability call
takes (mirrors §10.1's "bridge through the same dispatch"):

1. Resolve the contract (unknown ref → `CapabilityError:"unknown"`).
2. Resolve selection (no config entry → `CapabilityError:"unconfigured"` — the
   *degrade* error; callers surface it as `{mode:"unavailable", note}` data to
   the model, the prior art's exact discipline, now in one place).
3. Validate `input` against the contract (fail → non-retryable error).
4. Chain bookkeeping: push `capability:<ref>` hop; reject depth > 4 or a cycle.
5. For provider, then each fallback: lazily `registry.activate(id)`, find its
   `ProviderImpl`, push `provider:<id>@<version>` hop, invoke, validate
   `output`. Retryable failure → next in line; success → done.
6. All failed → `CapabilityError:"failed"` carrying the formatted chain and the
   last cause.

Everything crosses the bus **validated on both sides** — a provider can't
widen or narrow a contract silently, which is what makes providers actually
interchangeable.

---

## 4. Inputs / outputs (the `workflow_call` face)

Contracts carry the io schemas; providers implement them; the bus enforces them.
Skills that are *not* capability providers keep expressing io per-tool via
`define()` Effect Schema decoders — a tool schema **is** its input contract, and
tool results are strings by §7.2 design. The capability layer adds typed io only
where interchangeability is the point. (We deliberately did **not** put an
`io:` block on the manifest: it would duplicate either the contract or the tool
schemas, and drift.)

---

## 5. Opt-in enablement (registry/config amendment)

Adopted from the prior art's nullable-section gating, hardened one step:

- **Before:** a present config block implied enabled (`enabled` defaulted true).
- **Now:** a registrable is enabled **iff its config block says `enabled: true`**.
  Absent block, or a block without the flag → indexed (visible to `doctor`
  /inventory) but disabled. `RegistrableBase.enabled` defaults **false**.

Rationale: a config block is often *pre-staged* (secrets wired before rollout);
presence-implies-enabled turns staging into activation. Explicit beats implied,
and it matches the requirement that shipped packs are **not enabled by default**.

---

## 6. Secrets

### 6.1 Declaration (manifest, static)

```ts
interface SecretDecl {
  readonly name: string;           // snake_case, e.g. "api_key"
  readonly required?: boolean;     // default true
  readonly description?: string;
}
// Manifest gains:  readonly secrets?: readonly SecretDecl[];
```

### 6.2 Supply (config, interpolated)

```yaml
skills:
  firecrawl:
    enabled: true
    secrets: { api_key: "${VAULT:secret/services/agent-kit#firecrawl_key}" }
```

The existing loader interpolation (§5) resolves `${VAULT:…}`/`${ENV:…}` before
validation, so secret *values* exist only in process memory, never in the
last-known-good snapshot. At index time the registry checks the block against
the declarations: **undeclared key supplied** → disable + error event (the GH
"secret not declared in `workflow_call`" analog — an undeclared secret is a leak
waiting for a typo); **required secret missing** → disable + error event.
`ActivateCtx` gains `secrets: Readonly<Record<string, string>>` containing
exactly the declared names. Existing packs migrate their key material from ad-hoc
config fields (`api_key` at top level) to the declared block.

### 6.3 No inheritance, ever

GitHub needs `secrets: inherit` because a called workflow has no configuration
of its own. Our callees do — every provider is a registrable with its own
config slice. So the rule is stricter and simpler: **secrets never cross a
registrable boundary.** A caller cannot pass, read, or forward another
registrable's secrets; a provider always runs on its own. Where a contract's
input must carry sensitive material (e.g. an auth header on a generic request),
the contract's `redact` paths keep it out of chains/spans — but prefer designing
contracts so secrets stay on the provider side.

---

## 7. Versioning without repos

- **Registrables:** semver in `manifest.version` (already present, now
  load-bearing). The registry accepts **multiple registrables with the same id**
  and resolves exactly one per process: config may pin `version: "^1.2"`
  (default `*`), the highest satisfying version wins, the rest are indexed as
  `shadowed` (inventory shows them; they never activate). Range grammar is the
  useful subset: exact, `^`, `~`, bare major (`2`, `2.x`), `>=`, `*`.
- **File convention for coexisting majors:** current major lives at
  `src/<pack>/<skill>.ts`; the next at `src/<pack>/<skill>.v<N>.ts`, exporting
  the **same id** with `version: "N.0.0"`. Same id ⇒ same config block —
  selection is the `version:` pin, so a consumer migrates by editing one line,
  and rolls back the same way.
- **Contracts:** the major is **in the ref** (`page-fetch@1`); minor evolution
  of a contract must be additive-optional. Providers name the major they
  implement; one skill may provide `@1` and `@2` simultaneously during a
  migration.
- **Renames are migrations** (§26.2 already says so); a new major is *not* a new
  id. Mint a new id only when the meaning changes, not the interface.
- **Chain refs carry versions** (`firecrawl@0.2.0`), so "which version ran" is
  answerable from any trace or error, without a registry lookup.

---

## 8. Call-chain tracing (the run graph)

### 8.1 Shape

```ts
interface Hop {
  readonly kind: "turn" | "tool" | "capability" | "provider" | "job";
  readonly ref: string;          // "page-fetch@1", "firecrawl@0.2.0", tool name…
  readonly note?: string;
}
type CallChain = readonly Hop[];
```

`ToolCtx` gains an optional `chain`. The bus appends `capability:` and
`provider:` hops; nested capability calls extend the same chain. Rendered as
`turn:main → tool:watch_snapshot → capability:metric-rows@1 → provider:my-source@1.0.0`.

### 8.2 Where it surfaces

- **Spans:** the bus span carries `agentkit.chain` (formatted, capped ~512
  chars) alongside `agentkit.component.id` — SigNoz/Langfuse show who called
  what through what, per §10.1's "unwrap the bridge" rule.
- **Errors:** every `CapabilityError.message` embeds the formatted chain — a
  fallback exhaustion reads as a path, not a mystery.
- **Limits:** depth cap 4 (GH's nesting limit, same rationale) and cycle
  rejection by ref — both produce non-retryable errors naming the chain.
- **Redaction:** hops carry refs and notes only, never payloads; contract
  `redact` paths govern the one debug surface that samples input.

---

## 9. The packs (clean-room implementations)

All pack skills: `kind: "skill"`, disabled by default, config-gated, versioned
`0.1.0`, trust `read` unless stated. Bundle assignments stay within the closed
§26.4 vocabulary.

### 9.1 `skills/web` (extended)

- Existing providers gain declarations: `brave` → `web-search@1`
  `[api-key, snippets]`; `firecrawl` → `web-search@1` `[api-key, full-content]`
  + `page-fetch@1` `[readable, api-key]`; `webpage` → `page-fetch@1`
  `[free, raw, static-only]`. (First live use of the distinct-traits rule.)
  Key material moves to declared `secrets`.
- **`sitemap`** (new): `sitemap_list` — robots.txt `Sitemap:` directives, then
  `/sitemap.xml`, `/sitemap_index.xml`; expands one index level, bounded
  children and concurrency. Fetches raw XML itself — a sitemap is not a "page",
  and `page-fetch@1` providers may strip or render. (The capability-consumption
  dogfood lives in `skills/watch`/`skills/ops`, where it's genuine.)
- **`page-audit`** (new): `page_audit` — fetches raw HTML itself (an audit
  needs the markup, not a readable rendering) and runs pure extractors:
  title/description presence+length, canonical, H1 count, word count, mixed
  content, image hygiene (alt/dimensions/lazy), OG/Twitter presence, anchor rel
  hygiene, internal/external link split, JSON-LD parse + generic structural
  checks (parseable, `@type` present, absolute URLs, real ISO dates). Domain
  rubrics (Google rich-result taxonomies) stay out.

### 9.2 `skills/watch` (new dir) — observe → diff → trend → outcomes

The generic form of "watch a metric surface over time and close the loop on
interventions":

- `store.ts` — `WatchStore` port: dated snapshots (`save`, `previous`,
  `history(limit)`, retention cap) + an outcome ledger (load/save). Ships an
  in-memory impl; a Postgres impl is deferred and the port is the contract.
  Core storage uses Effect SQL and `@effect/sql-pg`; scoped LISTEN streams,
  reserved advisory-lock connections, and the Effect migrator preserve the
  session and transaction semantics required by jobs and scheduling.
- `diff.ts` — pure: two snapshots → `{improved, declined, entered, exited,
  actNow}` with direction-aware metric config (`up-good`/`down-good`),
  move threshold, and an "act now" floor on a secondary activity metric.
  Composite row keys join id+series with `\0` (never collide on real text).
- `trend.ts` — pure: `decaying(history)` (direction-aware weighted metric slid
  ≥ threshold across ≥3 snapshots while activity stays above a floor) and
  `splitAttribution(rows)` (one id served by ≥2 series, secondary series
  counted only above a share + weight floor).
- `outcomes.ts` — pure over the ledger: `recordOutcome` (id
  `<kind>:<subject>:<day>`, replace-on-dupe, capped) and `measureOutcomes`
  (younger than soak → soaking; older than retire → retired count; else
  re-measure via injected fetch and verdict improved/declined/flat/no-data from
  combined deltas with an epsilon).
- `skills.ts` — the `watch` registrable: tools `watch_snapshot` (pull rows via
  `metric-rows@1`, save, report the diff), `watch_trends`, `watch_outcome_record`,
  `watch_outcomes`; optional schedule. **Consumes** `metric-rows@1` — the
  data source is whatever provider the consumer wires, which is what makes the
  pack domain-free.

### 9.3 `skills/ops` (new dir) — spikes, hygiene, self-guard

- `spike.ts` — pure: `selectSpikes(items, {minCount, seen, ignore, isSelf})`;
  `correlateChanges(spikeFirstSeen, changes, windowMs)` (most recent successful
  change landing within the window *before* the spike). The `issue-feed@1`
  null-vs-empty discipline is enforced here: `null` (failed fetch) skips the
  cycle **without seeding baseline or marking seen** — the prior art's
  flood-prevention invariant, kept load-bearing.
- `hygiene.ts` — `SeenSet` (bounded, TTL-pruned) and `Cooldown` (keyed
  last-handled + window) with injected clocks; restart-volatile by design
  (worst case: one duplicate look, exactly the prior art's stance).
- `self-guard.ts` — pure `isSelfReference(identity, signals)`: slug-prefixed
  short-id, project equality, or project-id-in-URL; a free-text name mention is
  deliberately **not** a signal. Any reactive consumer calls this before acting.
- `skills.ts` — the `spike-watch` registrable: scheduled; consumes
  `issue-feed@1` (+ optional `change-feed@1`); first run seeds baseline
  silently; fresh spikes → one notify per spike via `NotifyPort`; nothing new →
  silent (§15 `[SILENT]` behavior). Read-only; `spike_status` tool for chat.

### 9.4 `integrations` (foundation + first client)

- `http.ts` — `makeHttp(service)`: `fetchJson`/`fetchText` returning
  `Effect.Effect<T, IntegrationError>`; non-2xx → `<service>.http` (status, body
  clipped), throw → `<service>.network`, bad JSON → `<service>.parse`; transient
  (429/5xx/network) retried with capped jittered backoff. Every client builds on
  it; the tag grammar is the §27.3 taxonomy extended one level.
- `google-auth.ts` — SDK-free SA-JWT: RS256-signed assertion via `node:crypto`,
  exchanged for a bearer, cached to 60 s before expiry. Construction-time
  failure on a bad SA file (unrecoverable boot error, load-bearing).
- `github.ts` — reference client (opt-in per §25): minimal typed surface —
  `getFile`, `createIssue`, `commentIssue`, `openDraftPullRequest` (git-data
  chain: base ref → tree → commit → ref → draft PR). Token via config secret;
  writes are explicit and few.
- The `github` skill (`skills/github`, opt-in) — its `draft_pr` write-tool
  **provides `change-proposal@1`** `[github, draft-pr]`, building on the
  `github.ts` client above. Input edits/creates are fenced by the provider's
  `allowed_prefixes` config (non-empty, no `..`, prefix match) and applied via
  `core/edits.ts` `applyAnchoredEdits` — an absent or ambiguous anchor **aborts
  the whole set** (no partial change ever lands). Branch names carry a mint-time
  stamp (re-proposing never collides). Output is a review URL; merge is always
  human. Trust: `write` — its tool registers behind the approval gate.

### 9.5 Cross-cutting conventions adopted (no code, but binding)

- **Fenced mutation:** any skill mutating namespaced remote state must fence a
  key prefix at create **and re-verify the fence at every subsequent mutation**
  (prior art: `seo-` flag keys). The github skill's `draft_pr` applies it to
  branch prefixes and path allowlists.
- **Audit actor:** an approved write records the acting principal as the agent,
  with the approval (nonce, approver, variant) in the staged-action record —
  the human clicked, the agent acted, both are in the trail.
- **Approval variants** (approval-gate extension): a staged action may carry
  `variants: [{label, args}]`; the gate renders one button per variant and the
  approver's choice — not the model's — fixes the disposition. First use:
  proposals vs. proposals-with-followup; prior art: cancel vs cancel+refund.
- **Null-vs-empty:** a feed fetch that *failed* is `null` and must never update
  dedupe/baseline state; only a real empty result advances state.

---

## 10. Naming conventions (amends §26)

New named things introduced here, same one-case-per-kind discipline:

| Named thing | Case | Shape | Examples |
| --- | --- | --- | --- |
| Capability ref | kebab + `@major` | `<noun[-verb]>@N` | `page-fetch@1`, `metric-rows@1` |
| Trait | lower kebab token | one short axis value | `free`, `api-key`, `readable` |
| Secret name | `snake_case` | noun | `api_key`, `token` |
| Pack dir | `skills/<domain>` | kebab | `skills/web`, `skills/watch`, `skills/ops` |
| Coexisting major file | `<skill>.v<N>.ts` | same id inside | `fetch.v2.ts` |
| Config: capability selection | the ref, verbatim | `capabilities."page-fetch@1"` | — |
| Chain hop ref | `<kind>:<ref>` | closed `kind` enum | `provider:firecrawl@0.2.0` |

Packs live under `skills/<domain>` (e.g. `skills/web`, `skills/watch`).

---

## 11. Deferred (identified, deliberately not built now)

Boot-failure capture (pre-init fatal → notify webhook), interval/cron check-in
wrappers beyond §12's liveness plan, the `route-vocab` tier-routing plugin, a
composite fan-out tool helper, the disk assets loader, a Postgres `WatchStore`,
and any `experiment@1` provider. Each has a clear home; none blocks the
mechanics above.

## 12. Testing

Bun tests, same style as the existing suite: capability bus (contract
validation both sides, unconfigured degrade, fallback on retryable-only, depth
/cycle caps, chain in errors), registry (opt-in enablement, distinct-traits
enforcement, secrets declared/required/undeclared, version resolution +
shadowing), semver ranges, watch diff/trend/outcomes (pure, table-driven), ops
spike/hygiene/self-guard (incl. null-vs-empty), rota, anchored edits
(unique/absent/ambiguous/abort-all), http error taxonomy + retry (stubbed
fetch), sitemap/page-audit extractors (fixture HTML), change-proposal fencing.
The static footprint gate (§11.3) picks the new packs up automatically at
registration — no new gate work.
