# Telemetry map

A read-only, self-contained observability map of the running agent. It mounts
HTTP routes on the shared runtime server and serves an isometric live view of how
a question flows through Elliott: gateway → runtime → prompt → router → model →
skills/MCP → database → memory → evolution, plus container health.

It never sends anything outbound (`egress: none`), never writes to the database
(it tails `sessions.sqlite` read-only), and never reads secret values. It
subscribes to the in-process telemetry bus for live turn activity. The assembled
prompt is included in the live feed only when `ELLIOTT_TELEMETRY_PROMPTS` is not
`0`; digests are always available.

Routes (mounted on the runtime server, published at `127.0.0.1:18082`):

- `GET /v1/observability/map` — the isometric UI (self-contained HTML).
- `GET /v1/observability/map/topology` — the connection graph (nodes/edges).
- `GET /v1/observability/map/state` — current snapshot (turns, db stats, events).
- `GET /v1/observability/map/stream` — Server-Sent-Events live feed.
- `GET /v1/observability/map/turn?id=<runId>` — one turn's full event detail.

This component exposes no tools to the model; it is operator-facing only.
