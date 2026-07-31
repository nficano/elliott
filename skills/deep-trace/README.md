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

## Design

See [`docs/explanation/deep-trace-plan.md`](../../docs/explanation/deep-trace-plan.md) for the full
feasibility study and architecture, and
[`topology/elliott-topology.enriched.json`](../../topology/elliott-topology.enriched.json) for the
machine-readable node/edge graph (served, with live packages merged in, at
`/topology`).
