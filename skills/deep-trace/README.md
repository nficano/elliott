# deep-trace

A read-only, self-contained **isometric live map** of the running agent. It shows
how a question flows through Elliott — gateway → runtime → prompt → router → model
→ skills/MCP → database → memory → evolution — with nodes and wires that light up
in real time as traffic flows, plus side panels for the live turn (including the
prompt relayed to the model and the router decision), database writes, and health.

It is an `extension`-kind component: it mounts HTTP routes on the shared runtime
server and runs one background service. It makes **no** outbound calls
(`egress: none`), never writes to the database (it tails `sessions.sqlite`
read-only), and never reads secret values.

## Two UIs, one extension

The explorer UI exists twice, verified byte-for-byte equivalent in behavior by
the Playwright parity suite (`app/e2e/parity.pw.ts`, run against both):

- **`app/`** — the primary UI: a Nuxt 4 + TypeScript + Tailwind v4 SPA.
  Typed engine modules live in `app/shared/`, HUD components in
  `app/app/components/` (with Storybook stories in `app/stories/`), and the
  generated build is committed at `app/dist/` so the extension can serve it
  (one exact-match route per file — see `src/app-dist.ts`).
- **`src/ui.html`** — the original single-file document, still served at
  `/legacy` and used as the parity baseline.

Rebuild the app after UI changes: `cd app && bun run generate` (the
`postgenerate` script refreshes `dist/`). App checks: `bun run lint`,
`bun run typecheck`, `bun test` (vitest), `bun run e2e` (Playwright parity),
`bun run storybook`.

## Reaching it

The extension rides the existing `elliott` container's `Bun.serve` (port 8080,
published by the base compose at `127.0.0.1:18082`). After a normal deploy:

```
http://127.0.0.1:18082/v1/deeptrace
```

Endpoints (all under `/v1/deeptrace`):

| Route | Serves |
| :--- | :--- |
| `/` | the explorer UI (Nuxt build when `app/dist` exists, else the legacy document) |
| `/legacy` | the original self-contained HTML/canvas document |
| `/topology` | the connection graph — `topology/elliott-topology.enriched.json` plus every auto-registered skill (see below) |
| `/state` | current snapshot: turns, db table counts + recent rows, recent events |
| `/stream` | Server-Sent-Events live feed of turn activity |
| `/turn?id=<runId>` | one turn's full event list (rounds, prompt, tools) |
| `POST /send` | inject a message; answers captured by the deep-trace gateway |

## Skill auto-registration

Every loaded package that declares a `spec.topology` block in its manifest
auto-registers on the served graph — no hand-editing of the enriched document.
At request time `/topology` merges (`src/auto-topology.ts`, same derivation
semantics as `scripts/gen-topology.mjs`):

- **Nodes** for skills the enriched document doesn't know (framework and
  agent-level skills alike), with uniform edges derived from
  `spec.topology.dispatch` and any declared `edges` (`self` substituted).
- **Liveness** resolved from what actually registered: a registration with at
  least one binding reads `live`; anything else reads `config-gated`. This
  also overrides `runtime` on enriched nodes when the static claim is stale.
- **Facility grant edges** (consumer → provider, kind `control`) from the
  persisted `facilities/grants.json`, so provisioning chains like
  webhook-provisioner → traefik/pihole appear without any declaration.

The merged document carries an `autoRegistration` summary (added node ids,
added edge ids, liveness overrides). With nothing to merge, the enriched file
is served byte-for-byte.

## How it taps the live system

Two tiers, both verified end-to-end:

- **Durable (no core coupling):** a read-only tail of `sessions.sqlite` surfaces
  every table's count/delta and recent rows (`runs`, `tool_calls`,
  `model_selections`, `model_usage`, `messages`, …), plus `/healthz` and
  `/v1/components`.
- **Live stream:** the in-process `RuntimeTelemetry` bus (`src/runtime/telemetry.ts`)
  fans out per-turn events — `inbound`, `turn.begin`, `model.request` (the assembled
  prompt), `model.selection` (the router decision), `tool.progress` (skill/MCP
  fires), `turn.finish`, and `db.write`. The map subscribes; nothing is persisted.

## Prompt visibility

`model.request` includes the raw system prompt + messages only when
`ELLIOTT_TELEMETRY_PROMPTS` is not `"0"` (default on). Digests are always emitted.
Toggle via `deploy/compose.deep-trace.override.yml`.

## Design rationale

- **It maps the production runtime (`src/runtime/*`), not the canonical
  framework.** The canonical layer's orchestrator is intentionally stubbed, so
  its richer signals (persisted audit records, router pruning traces) are not
  live. The topology JSON marks those as `tier:"C"` taps so the UI has
  placeholders ready to absorb them when the canonical orchestrator lands —
  e.g. an `AuditLog.append` wrapper streaming `model.*` / `broker.*` /
  `evolution.*` records.
- **A core bus instead of observer injection.** The runtime composes
  `TurnObserver`s internally (gateway response + evolution evidence) and has no
  general "add an observer" hook, so the live tier is a small in-process
  `RuntimeTelemetry` singleton that core emits into — the extension only
  subscribes. If the bus module is absent the extension degrades to the
  durable tier alone.
- **Security posture.** `egress: none` (no outbound calls, no CDN — the UI is
  fully inlined), the SQLite tail opens `{ readonly: true }`, secret sources
  render as field *names* only, tool args/results appear as digests
  (`schemaDigest`/`argumentsDigest`/`resultDigest`), and the server binds
  localhost (`127.0.0.1:18082`) — exposing it further is an explicit operator
  choice.
- **Eventually consistent to ~1.5 s** on the durable tier (WAL reader tailing
  by `max(rowid)`); the stream tier is real-time.

The machine-readable node/edge graph is
[`topology/elliott-topology.enriched.json`](../../topology/elliott-topology.enriched.json)
(served, with live packages merged in, at `/topology`). Nodes carry their
`source` (file:line) and `taps` (which live signals prove them), so the JSON
doubles as a navigable index of the codebase wiring.
