# telemetry-map

A read-only, self-contained **isometric live map** of the running agent. It shows
how a question flows through Elliott — gateway → runtime → prompt → router → model
→ skills/MCP → database → memory → evolution — with nodes and wires that light up
in real time as traffic flows, plus side panels for the live turn (including the
prompt relayed to the model and the router decision), database writes, and health.

It is an `extension`-kind component: it mounts HTTP routes on the shared runtime
server and runs one background service. It makes **no** outbound calls
(`egress: none`), never writes to the database (it tails `sessions.sqlite`
read-only), and never reads secret values.

## Reaching it

The extension rides the existing `elliott` container's `Bun.serve` (port 8080,
published by the base compose at `127.0.0.1:18082`). After a normal deploy:

```
http://127.0.0.1:18082/v1/observability/map
```

Endpoints (all under `/v1/observability/map`):

| Route | Serves |
| :--- | :--- |
| `/` | the isometric UI (self-contained HTML/canvas) |
| `/topology` | the connection graph — same as `docs/telemetry-map-topology.json` |
| `/state` | current snapshot: turns, db table counts + recent rows, recent events |
| `/stream` | Server-Sent-Events live feed of turn activity |
| `/turn?id=<runId>` | one turn's full event list (rounds, prompt, tools) |

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
Toggle via `deploy/compose.telemetry-map.override.yml`.

## Design

See [`docs/telemetry-map-plan.md`](../../docs/telemetry-map-plan.md) for the full
feasibility study and architecture, and
[`docs/telemetry-map-topology.json`](../../docs/telemetry-map-topology.json) for the
machine-readable node/edge graph (served verbatim at `/topology`).
