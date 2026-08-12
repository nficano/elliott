# Activation state

Every bundled component ships enabled in code but stays **dormant until its
configuration is complete** — a missing secret, an empty allowlist, or an
`enabled: false` flag keeps a skill loaded-but-unregistered without failing
boot. This page explains how to read the current activation state of a
deployment; it intentionally lists no per-deployment status (that belongs in
the operator's own runbook).

## Where to look

- **`GET /healthz`** — per-gateway status, per-service health, tool/skill
  counts, and (when an `install:` block is configured) a per-skill install
  section. A required (gateway) skill that failed to install flips
  `ready: false`.
- **`GET /v1/observability/map`** (deep-trace) — every loaded package appears
  on the map with its runtime state: `live` (registered with bindings) or
  `config-gated` (loaded but dormant, usually a missing secret or disabled
  flag).
- **Boot logs** — a skill whose `register()` returns no bindings, or whose
  secret is unresolvable, is reported and skipped; boot continues degraded.

## Common gates

| Component | Dormant until |
| --- | --- |
| `terminal` | `tools.terminal.enabled: true` plus a non-empty `allowed_commands` |
| `ssh` | `tools.ssh.enabled: true`, a non-empty `hosts` allowlist, and `ssh_private_key` |
| `deep-trace` publish | `proxy.route` + `dns.local` facility providers installed, plus `public_hostname`/`service_url` |
| gateways (registry) | their channel secrets (tokens, signing secrets) |
| `store` vectors | a reachable Postgres with `pgvector` at `store.dsn` |

The general rule: provide the secret or flip the flag, restart, and the
component registers on the next boot — no code changes involved.
