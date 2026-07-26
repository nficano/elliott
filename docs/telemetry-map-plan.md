# Elliott Live Wiring Map — Feasibility Study & Design Plan

> An isometric, real‑time observability map that lets you *watch* Elliott think:
> a question arrives → a prompt is assembled → the router picks a model → the
> model answers → skills/MCP fire → rows land in the database → memory updates →
> evolution learns → containers stay healthy. Built as a first‑class Elliott
> **extension** that rides the existing runtime container and is served over HTTP.

**Status:** design complete, feasibility **confirmed**. Deliverables:
`docs/telemetry-map-plan.md` (this file), `docs/telemetry-map-topology.json` (the
machine‑readable connection graph), and `skills/telemetry-map/` (the extension).

---

## 1. Feasibility verdict

**Feasible, today, with a small and honest footprint.** Elliott already exposes
almost everything the map needs, and the one genuine gap (the raw prompt text
sent to the model) is closable with a ~3‑file, in‑process telemetry bus that
matches Elliott's own "record‑always, cheap bookkeeping" philosophy.

The build splits cleanly into two tiers:

| Tier | What it shows | Data source | Core edits |
| :--- | :--- | :--- | :--- |
| **A — durable/poll** | components, health, containers, turns, tool/skill fires, model selections, token/cost, conversation messages, evolution runs | `/healthz`, `/v1/components`, read‑only `sessions.sqlite`, evolution store files | **none** |
| **B — live stream** | a question landing in real time; the *assembled system prompt*; the router decision; streamed model tokens; each tool fire the instant it happens | in‑process `RuntimeTelemetry` bus (SSE) | ~3 files, ~40 lines |

Tier A alone is a fully useful map and is 100% self‑contained in `skills/`.
Tier B is what satisfies the explicit ask — *"ask a question, see the prompt
relayed to a model, and the router."* We build both; the extension degrades
gracefully to Tier A if the bus is absent.

### Why it's the *production runtime* we map (important)

The repo contains **two layers**:

- **Canonical framework** — `src/loop`, `src/model` (orthogonal router,
  `ModelDispatcher.select` → `model.selection` record), `src/security` (capability
  broker, IFC), `src/audit` (hash‑chained, Merkle‑cross‑linked log). This is the
  documented security design, but its end‑to‑end orchestrator is **stubbed**:
  `AgentTurnLoop` calls `LoopModelDispatcher.infer`, whose only implementation
  returns `{text:"ready"}` (`src/agent/index.ts:124`). Nothing converts a
  `PromptAssembly` into a real model call here yet.
- **Production runtime** — `src/runtime/*`. This is what `bun src/runtime/main.ts`
  actually boots (`Dockerfile:13`). `RuntimeAgent.turn` runs the real round loop,
  `RuntimeModelClient` POSTs OpenAI‑style to LiteLLM, and evidence persists to
  **SQLite** (`sessions.sqlite`) via `SessionStore` + `RuntimeEvolutionEvidence`.

The map targets the **production runtime** because that is the live system. Where
the canonical framework's richer signals (audit records, router pruning trace)
become live in future, the map has clearly‑marked seams to absorb them (§8.4).

---

## 2. What the map must answer (from the goal)

| You asked to see… | Where it comes from | Tier |
| :--- | :--- | :--- |
| How you communicate with Elliott (gateway → runtime) | gateway `onMessage` → `#handleInbound` (`app.ts:245`); telemetry `inbound` | B (A shows it post‑hoc from `sessions`) |
| What skill / MCP fired, what was sent/received | `TurnObserver.onToolProgress` (`agent.ts:120/131/146`); `tool_calls`/`component_uses` tables; `mcp.exposure-*` records | A+B |
| The prompt relayed to the model | telemetry `model.request` from `RuntimeModelClient.complete` (`model/client.ts:36`) — **needs the bus** | B |
| The router decision | `TurnObserver.onModelSelection` → `RuntimeModelSelection {routeDigest, usageReference}` (`agent.ts:73`); `model_selections` table; (future) `model.selection` record + route trace | A+B |
| What goes into the database | read‑only tail of `sessions.sqlite` (`runs`, `messages`, `tool_calls`, `component_uses`, `model_selections`, `model_usage`, `feedback`, `scheduled_jobs`) | A |
| How memory is stored | `messages` table (+FTS mirrors), `model_usage`, conversation history in `RuntimeAgent`; curated/external‑slot providers (dormant unless wired) | A |
| How services/containers fire | `/healthz` (`ready`, per‑gateway status, per‑service health), `/v1/components`, Docker/compose topology | A |
| How evolution is learning | `evolution.*` records, `elliott_evolution_*` metrics, evolution store files (`runs/ candidates/ reports/ releases/`), `runs`/`model_selections` evidence | A (+B for live notifications) |

---

## 3. Live data‑source inventory (the feasibility core)

The map is only as good as the taps it can read. Here is the full, verified set.

### 3.1 HTTP surfaces already served (poll)
Served by the single `Bun.serve` in `src/runtime/server.ts:3`, routed in
`ElliottRuntime.#handleRequest` (`app.ts:319`):
- `GET /healthz` → `RuntimeHealth` = `{ready, release, skills, tools, gateways:{name→status}, services:{name→{metric→number}}}` (`app.ts:168`, `types.ts:308`).
- `GET /v1/components` → `[{name, kind, protocols}]` (`server.ts:13`).
- `POST /v1/control/evolution` → evolution control plane (token‑gated).

### 3.2 `sessions.sqlite` — the durable write ledger (read‑only tail)
File: `<root>/.elliott-runtime/sessions.sqlite` (WAL mode) — `app.ts:76`,
schema DDL `src/memory/session-store/index.ts:25` and
`src/memory/session-store/evolution.ts:12`. Tables the map reads:

| Table | Written by | Carries |
| :--- | :--- | :--- |
| `sessions` | `createSession` | id, source, principal, parent_id, created_at |
| `messages` (+ `messages_fts_trigram`, `messages_fts_cjk`) | `appendMessage` | role, **content**, classification, created_at |
| `model_usage` | `recordUsage` | input_tokens, output_tokens, cost_usd |
| `gateway_routing` | `setGatewayRoute` | route_key → session_id |
| `scheduled_jobs` | scheduler | principal, agent, capabilities(JSON), run_at, payload(JSON), recurrence |
| `runs` | `recordRun`/`finishRun` | run id, conversation, channel, snapshot, started_at, finished_at, disposition |
| `model_selections` | `recordModelSelection` | route digest, usage reference, per‑round |
| `tool_calls` | `recordToolCall` | requested vs selected tool, latency, outcome, digests |
| `component_uses` | `recordComponentUse` | component ref, count |
| `feedback` | `recordFeedback` | sentiment, source (button/reaction) |
| `evaluation_labels` | curator | label evidence |

Every row carries a monotonic `created_at`/`started_at`, so the map tails by
`max(rowid)` per table on a short interval (default 1500 ms). Concurrent WAL
readers are safe alongside the runtime's writer.

### 3.3 `TurnObserver` — the real‑time per‑turn signal
`src/runtime/types.ts:294`. Threaded into `agent.turn(...)` via `TurnOptions.observer`:
- `onTextDelta(delta)` — streamed model output tokens.
- `onModelSelection({routeDigest, usageReference})` — **router decision** (`agent.ts:73`).
- `onToolProgress({id, name, status, requestedTool, selectedTool, schemaDigest, argumentsDigest, resultDigest, errorTag})` — **skill/tool fired** (`agent.ts:120/131/146`).

Today the observer is composed only from the gateway's `beginResponse` observer
and the evolution‑evidence wrapper (`app.ts:270–284`, `evolution-evidence.ts:137`).
There is **no general "add an observer" hook** — this is exactly why Tier B adds a
bus rather than trying to inject an observer from a skill.

### 3.4 Error / lifecycle stream
- `RuntimeErrorReporter.capture(error, mechanism)` (`reporter.ts:16`) — every failure
  boundary tags a `mechanism` (`turn`, `gateway:<name>`, `skill:<name>`, `mcp:<id>`,
  `evolution-evidence`). Console + optional GlitchTip.
- `logRuntimeStarted` (`logging.ts:3`) — the `elliott.runtime.started` JSON line.

### 3.5 Evolution artifacts (poll/watch)
- Records: `evolution.*` (25 types, durability table `src/learning/evolution/records.ts:8`).
- Metrics: `elliott_evolution_*`, snapshot via `evolutionMetricSnapshot` (`metrics.ts:230`).
- Files under the evolution root: `runs/`, `candidates/`, `datasets/`, `reports/`,
  `releases/`, `release-monitor-reports/`, and per‑target projection JSONs
  (`continuous/projections.ts:98`); proposal dirs `<prp-*>/proposal.yaml`.
- Continuous DB: `<stateRoot>/continuous.sqlite` (same schema as sessions).

### 3.6 Container / process topology (static + probed)
- `deploy/docker-compose.yml`: `elliott` (app, `127.0.0.1:18082→8080`), `postgres`
  (`pgvector/pgvector:pg16`), `agent-browser` (`browserless/chromium`, isolated net).
- Health via each service's Docker `healthcheck`; the app's own liveness via `/healthz`.
- The map can optionally read the Docker socket if mounted (off by default; the
  extension declares `egress: none` and does **not** request the socket).

---

## 4. The isometric scene — nodes & edges

The map renders Elliott as an **isometric tile world**. Each subsystem is a
"building"; each wire is a lane that lights up and animates a packet when traffic
flows. The authoritative node/edge list is `docs/telemetry-map-topology.json`
(§7 explains the schema). Summary:

### 4.1 Nodes (lanes / zones)

```
                          ┌──────────────────────────────────────────┐
   ── GATEWAYS ──         │              RUNTIME CORE                 │      ── PROVIDERS ──
  Slack  Gmail  IMAP      │  Bun.serve ── #handleRequest              │      LiteLLM (h12o)
  BlueBubbles  Webhook    │      │                                    │      ↳ haiku/sonnet/opus
  Home‑Assistant  Cron    │  RuntimeAgent.turn ── round loop (≤8)     │      Ollama (local, opt)
        │                 │      │        │            │              │
        └──── inbound ───►│  prompt   RuntimeModelClient  tool exec   │
                          │  assembly ──► /chat/completions ──────────┼────►
                          │      │        │            │              │
                          └──────┼────────┼────────────┼──────────────┘
                                 ▼        ▼            ▼
     ── SKILLS / TOOLS ──   ── MEMORY / DB ──    ── LEARNING ──   ── OBSERVABILITY ──
  files terminal ssh fetch  SessionStore         SignalDetector    RuntimeTelemetry bus
  search‑* web‑* browser    sessions.sqlite      Curator/Triage    FootprintTracker
  scheduler  mcp‑client     ├ messages           Evaluator (12‑gate) AuditLog (in‑mem)
        │                    ├ runs/tool_calls    Companions:        GlitchTip reporter
  ── MCP ENDPOINTS ──        ├ model_selections    dspy darwinian     /healthz  /v1/components
  h12o   home‑assistant      ├ model_usage         benchmarks
  (external servers)         └ scheduled_jobs      Proposals → canary → promote/rollback

  ── CONTAINERS ──  elliott (app)   postgres (pgvector)   agent-browser (chromium)
```

Node kinds: `gateway`, `runtime`, `agent-loop`, `router`, `provider`, `tool`,
`skill`, `mcp-endpoint`, `memory`, `database`, `learning`, `evaluator`,
`observability`, `container`, `secret-source`.

### 4.2 Edges (what connects to what)

Representative edges (full list in the JSON):
- `gateway.* → runtime.handleRequest` (inbound message) — *animated per turn*.
- `runtime.handleRequest → agent.turn` (dedup + snapshot pin).
- `agent.turn → prompt.assembly → router` (system prompt + messages + tools).
- `router → provider.litellm` (`/chat/completions`) — *animated per round*, carries
  model id + token/cost.
- `agent.turn → tool.* / mcp-endpoint.*` (tool call) — *animated per tool fire*.
- `agent.turn → memory.sessionStore → database.sessions` (evidence + messages) —
  *animated per DB write*.
- `agent.turn → observability.telemetry` (every stage) — the map's own feed.
- `feedback → learning.signals → curator/triage → evaluator → proposals →
  canary → promote|rollback` (evolution pipeline) — state‑machine coloring.
- `container.elliott ⇄ container.postgres`, `container.elliott → container.agent-browser`.
- `secret-source.vault → runtime.config` (rendered env; never shown as values).

Edge attributes: `id`, `from`, `to`, `kind` (`data|control|persist|learn|health|
secret`), `label`, `animatable` (bool), `wire` (e.g. `http`, `sqlite`, `jsonrpc`,
`in-process`), and `evidence` (which tap proves it fired).

---

## 5. Extension architecture

```
skills/telemetry-map/
├── component.yaml        # kind: extension, profile: extension-standard, egress: none
├── EXTENSION.md          # model-visible doc (required by the bundled loader)
└── src/
    ├── index.ts          # register(context) → { routes:[...], services:[...] }
    ├── aggregator.ts      # rolling in-memory state: turns, tools, models, db-stats, evo
    ├── sqlite-tail.ts     # read-only tail of sessions.sqlite (Tier A)
    ├── topology.ts        # imports/serves docs/telemetry-map-topology.json
    ├── sse.ts             # Server-Sent-Events fan-out over Bun ReadableStream
    └── ui.ts              # the self-contained isometric HTML/CSS/JS (one string)

src/runtime/telemetry.ts   # NEW core: singleton RuntimeTelemetry bus (Tier B)
src/runtime/app.ts         # +emit inbound / turn.begin / turn.finish; compose observer
src/runtime/model/client.ts# +emit model.request (the prompt!) / model.response
```

### 5.1 The registration (rides the shared server)
`register(context)` returns:
- **routes** (auto‑mounted on the existing `Bun.serve`, exact method+path match —
  `app.ts:337`):
  - `GET  /v1/observability/map` → the isometric UI (self‑contained HTML).
  - `GET  /v1/observability/map/topology` → the connection‑graph JSON.
  - `GET  /v1/observability/map/state` → current snapshot (components, health,
    recent turns, tool fires, model selections, db stats, evolution).
  - `GET  /v1/observability/map/stream` → **SSE** live feed (telemetry bus + tail).
  - `GET  /v1/observability/map/turn?id=<runId>` → one turn's detail (prompt,
    router decision, rounds, tool calls) — prompt text only if the bus captured it.
- **service** `telemetry-map`: starts the SQLite tail loop + subscribes to the
  telemetry bus; `health()` surfaces `{subscribers, events, dbRows, lastTurnAgeMs}`
  into `/healthz` → `services["telemetry-map"]`.

Everything is self‑contained: no external CDN (Elliott's egress model + the map's
`egress: none`), so the UI inlines its CSS/JS and draws the isometric scene on a
`<canvas>` with hand‑rolled iso projection (no libraries).

### 5.2 The telemetry bus (Tier B, core)
`src/runtime/telemetry.ts` — a dependency‑free singleton:
- bounded **ring buffer** (default 512 events) for late subscribers / `state`.
- `Set<subscriber>` fan‑out; `emit(event)`, `subscribe(fn)→unsub`, `recent()`.
- typed events (discriminated union): `inbound`, `turn.begin`, `model.request`,
  `model.selection`, `text.delta`, `tool.progress`, `turn.finish`, `db.write`,
  `error`, `evolution`.
- **Privacy gate**: `model.request` includes the assembled system prompt + messages
  only when `ELLIOTT_TELEMETRY_PROMPTS !== "0"` (default on for this troubleshooting
  build; digests are always emitted regardless). Documented as a security choice
  (§6) so an operator can flip it off in shared environments.

Core emit points (minimal, clearly commented):
- `app.ts #handleInbound`: `inbound` (message meta), `turn.begin`, `turn.finish`;
  and compose a telemetry observer with the existing `evidence.observer` so
  `model.selection` / `tool.progress` / `text.delta` flow without changing `agent.ts`.
- `model/client.ts complete()`: `model.request` (model, system, messages, tool names)
  and `model.response` (usage, output length).

The extension only **subscribes**. Core produces; the map consumes. If
`telemetry.ts` is ever removed, the extension detects the missing module and runs
Tier A only.

### 5.3 Data flow of one question (what you'll watch light up)
```
Slack ──inbound──► #handleRequest ──► #handleInbound
   │  telemetry:inbound                telemetry:turn.begin
   ▼
RuntimeAgent.turn ── round 0 ──► RuntimeModelClient.complete
   │                               telemetry:model.request  ← the PROMPT
   │                               ── POST /chat/completions ──► LiteLLM
   │                               telemetry:model.selection ← the ROUTER
   │                               telemetry:text.delta (stream)
   ├── tool calls? ──► #execute ──► tool.execute()
   │        telemetry:tool.progress in_progress → complete/error
   │        (writes tool_calls / component_uses rows → telemetry:db.write)
   └── no tool calls ──► answer ──► response.complete()
            telemetry:turn.finish (disposition, tokens, cost)
```

---

## 6. Security & privacy

The map is a troubleshooting lens, so it deliberately follows Elliott's posture:
- **`egress: none`** in `component.yaml` — the extension makes no outbound network
  calls; it only reads local state and serves HTTP on the existing port.
- **Read‑only DB** — the SQLite tail opens with `{ readonly: true }`; it never writes.
- **No secrets, ever** — `secret-source.vault` appears as a *node* with field
  *names* only; values are never read or rendered. Config is shown as resolved/not.
- **Digests by default** — tool args/results are hashed in `TurnToolProgress`
  (`schemaDigest`/`argumentsDigest`/`resultDigest`); the map shows fingerprints,
  matching Elliott's IFC model. Raw conversation `messages.content` is already in
  the DB and shown as‑is (it is the user's own data), consistent with "Elliott
  protects your data *from* components, not from you."
- **Prompt exposure is gated** — `model.request` prompt text is behind
  `ELLIOTT_TELEMETRY_PROMPTS` (default on locally; set `0` to show digests only).
- **Bind‑local** — the runtime already publishes `127.0.0.1:18082` only; the map
  inherits that. Exposing it beyond localhost is an explicit operator choice
  (front it with the existing cloudflared/webhook auth if ever needed).

---

## 7. The connection‑graph JSON

`docs/telemetry-map-topology.json` is the machine‑readable "what connects to what"
that the goal asked for, and is *the same file the extension serves* at
`/v1/observability/map/topology`. Schema:

```jsonc
{
  "version": "1.0.0",
  "generatedFrom": "elliott production runtime (src/runtime/*)",
  "layers":  [ { "id": "gateways", "title": "…", "iso": {"col":0,"row":0} } ],
  "nodes":   [ { "id": "runtime.agentLoop", "kind": "agent-loop",
                 "layer": "runtime", "title": "RuntimeAgent.turn",
                 "source": "src/runtime/agent.ts:42",
                 "iso": {"col":3,"row":1,"h":2},
                 "taps": ["telemetry:turn.begin","db:runs"],
                 "metrics": ["roundsPerTurn","toolFires"] } ],
  "edges":   [ { "id":"e.gw.rt", "from":"gateway.slack", "to":"runtime.http",
                 "kind":"data", "wire":"in-process", "label":"inbound message",
                 "animatable":true, "evidence":"app.ts:245 #handleInbound" } ],
  "taps":    [ { "id":"telemetry:model.request", "tier":"B", "live":true,
                 "source":"src/runtime/model/client.ts:36",
                 "shows":"assembled prompt + model id" } ],
  "eventTypes": [ { "type":"model.selection", "shows":"router decision",
                    "payload":["routeDigest","usageReference"] } ]
}
```

Nodes carry their **`source`** (file:line) and **`taps`** (which live signals prove
them), so the JSON doubles as a navigable index of the codebase wiring.

---

## 8. Build plan (phases)

### 8.1 Phase 0 — deliverables scaffolding ✅ (this doc + JSON)
Write `docs/telemetry-map-plan.md` and `docs/telemetry-map-topology.json`.

### 8.2 Phase 1 — the extension skeleton (Tier A, zero core edits)
1. `skills/telemetry-map/component.yaml` (`kind: extension`, `profile:
   extension-standard`, `document: EXTENSION.md`, `egress:{class:none}`,
   `isolation: container`, `exports:[{ref:extension/telemetry-map,
   implementation:src/index.ts}]`), mirroring `skills/cloudflared/component.yaml`.
2. `EXTENSION.md` (required doc).
3. `src/index.ts` `register()` → routes (UI, topology, state, stream) + service.
4. `src/sqlite-tail.ts` read‑only tail of `sessions.sqlite`; `src/aggregator.ts`
   rolling state; `src/topology.ts` serves the JSON; `src/ui.ts` isometric canvas.
5. Verify discovery: `loadBundledPackages` picks it up (`app.ts:85`); route mounts.

### 8.3 Phase 2 — the telemetry bus (Tier B, minimal core)
1. `src/runtime/telemetry.ts` singleton bus (typed events, ring buffer, gate).
2. `app.ts`: emit `inbound`/`turn.begin`/`turn.finish`; compose telemetry observer.
3. `model/client.ts`: emit `model.request`/`model.response`.
4. Extension `src/sse.ts` subscribes and streams; UI animates lanes on events.

### 8.4 Phase 3 — canonical‑layer absorption (forward‑looking, optional)
When the canonical orchestrator lands (real `LoopModelDispatcher.infer` →
`ModelDispatcher.select` → `model.selection` record + route pruning `trace`), add
an `AuditCommitAdapter` tap (or wrap `AuditLog.append`) to stream `model.*`,
`broker.*`, `residency.*`, `evolution.*` records. The topology JSON already lists
these as `tier:"C"` taps so the UI has placeholders ready.

### 8.5 Phase 4 — containerize & expose
The extension already runs **inside the `elliott` container** and is served on the
shared `Bun.serve` (`8080` → published `127.0.0.1:18082`). Concretely:
- No Dockerfile/compose change is required (skills are copied into the image;
  `.dockerignore` does not exclude `skills/`).
- Reachable at `http://127.0.0.1:18082/v1/observability/map` after a normal deploy.
- Optional convenience: `deploy/compose.telemetry-map.override.yml` publishing a
  friendly host port (e.g. `127.0.0.1:18090→8080` is the same server, so we instead
  just document the existing `18082`), and a one‑liner in the deploy Slack announce.

---

## 9. Verification plan

1. **Typecheck / lint / format** — `bun run typecheck`, `eslint`, `dprint check`
   on the new files (repo runs a strict custom ESLint incl. Effect + IFC rules).
2. **Extension unit harness** — a Bun test that imports `register()` with a fake
   `SkillContext`, asserts the four routes + service exist, drives synthetic
   telemetry events + a temp SQLite fixture, and checks `state` / `stream` output.
3. **Live boot smoke** — boot the runtime with dummy env for the required Vault
   fields (`litellm_key`, `browser_token`, `postgres_dsn`, `glitchtip_dsn`,
   `slack_*` set to placeholders so `resolveTree` succeeds), then
   `curl /healthz` (expect `services["telemetry-map"]`), `curl
   /v1/observability/map/topology`, and load `/v1/observability/map` in a browser.
4. **End‑to‑end animation** — inject a synthetic inbound turn through the bus and
   confirm the UI lights the gateway→runtime→router→provider→tool→db lanes and the
   turn detail shows the (gated) prompt + router decision.

---

## 10. Risks & limitations (stated honestly)

- **Prompt visibility requires the bus.** Only digests are persisted; without
  `src/runtime/telemetry.ts` the map cannot show the raw assembled prompt (Tier A
  still shows the conversation `messages` and every model selection/usage).
- **Router detail is coarse in the runtime.** The production path attests a
  `routeDigest` over `{baseUrl, model}` (`model/client.ts:65`); the rich
  `ModelSelectionRecord` (effective profile, classification, pruning trace) is a
  canonical‑framework structure that only becomes live in Phase 3.
- **Audit log is in‑memory.** The tamper‑evident `AuditLog` isn't persisted by
  default and isn't wired into the runtime turn path; the map treats it as a
  Phase‑3 tap, not a Tier‑A source.
- **Exact‑match routing.** The shared server matches method+path exactly
  (`app.ts:337`), so each endpoint is a distinct `RouteBinding` (no path params).
- **Single writer, WAL reader.** The tail relies on WAL concurrent reads; safe, but
  the map is eventually‑consistent to ~1.5 s in Tier A (Tier B is real‑time).
- **Not a second framework.** The extension adds one in‑process bus and a UI; it
  vendors nothing, respects `egress: none`, and can be deleted with zero residue.
```

