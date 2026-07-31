# Configuration reference

The production runtime reads two files at the config boundary. No other
module reads `process.env` — that is a lint-enforced rule.

- `config/elliott.yaml` — runtime configuration
- `config/secrets.yaml` — a flat map of secret names to opaque references

## `config/elliott.yaml`

Top-level sections:

| Section         | Purpose                                                       |
| :-------------- | :------------------------------------------------------------ |
| `runtime`       | `timezone`, `http.port`                                       |
| `store`         | Postgres DSN (secret reference), `pool.max`, `vectors` (dim/type) |
| `llm`           | `base_url`, `api_key`, `max_parallel`, model tiers, profiles  |
| `budgets`       | `cold_tokens_max`, `monthly_usd_max`, `per_turn_usd_max`      |
| `observability` | `otel.endpoint`, `glitchtip.dsn` + `environment`              |
| `notify`        | `webhook_url`, `default_channels`                             |
| `tools`         | per-tool enablement + allowlists (below)                      |
| `channels`      | gateway enablement (email, bluebubbles, home_assistant, …)    |
| `gateways`      | gateway-specific settings (e.g. `cloudflared.ready_url`)      |
| `skills`        | per-skill settings (e.g. `deep_trace.public_hostname`)        |
| `install`       | registry skills to install (see the [registry guide](../guides/install-registry-skills.md)) |

### `llm`

Model selection is by tier, never by hardcoded provider model name in
agent code:

```yaml
llm:
  base_url: https://…/v1
  api_key: ${VAULT:…}
  max_parallel: 12
  models:
    utility:  { model: tier-local, context_window: 32768 }
    fast:     { model: anthropic/claude-haiku-4-5, context_window: 200000 }
    standard: { model: anthropic/claude-sonnet-5, context_window: 200000 }
    deep:     { model: anthropic/claude-opus-4-8, context_window: 200000 }
    embed:    { model: tier-local-embed }
  profiles:
    default: { max_tokens: 4096, temperature: 0.4 }
    writing: { max_tokens: 32768, temperature: 0.7 }
```

### `tools` (fail-closed allowlists)

```yaml
tools:
  files:
    enabled: true
    root: .elliott-runtime/workspace   # symlink-escape checked on every read/write
  terminal:
    enabled: false
    root: .elliott-runtime/workspace
    allowed_commands: []               # empty ⇒ tool does not register
  ssh:
    enabled: false
    user: elliott
    hosts: []                          # empty ⇒ tool does not register
```

A tool with `enabled: true` but an empty allowlist still registers
nothing. See [Enable terminal and SSH](../guides/enable-terminal-and-ssh.md).

## `config/secrets.yaml`

A flat map from secret name to an opaque Vault reference:

```yaml
brave_api_key: ${VAULT:secret/services/elliott#brave_api_key}
ssh_private_key: ${VAULT:secret/services/elliott#ssh_private_key}
```

Reference syntax: `${VAULT:<mount/path>#<field>}`. Rules:

- Secrets are resolved **only** at the config boundary, at boot.
- A reference whose Vault field is missing is **omitted, not fatal**: the
  skills that need it stay unregistered while the rest of the runtime
  starts. Current dormant-by-provisioning components are listed in
  [activation status](blockers.md).
- Never hardcode a secret value, log one, or interpolate one into an error
  message that leaves the process.

## Environment

| Variable      | Effect                                    |
| :------------ | :---------------------------------------- |
| `ELLIOTT_ENV` | `dev` selects development behavior (`bun run dev`) |
| `ELLIOTT_CONTROL_PLANE_URL` / `_TOKEN` | evolution CLI only — see [CLI](cli.md) |
| `ELLIOTT_SECRETS_FILE` | path to a mounted JSON object whose entries join the boundary's environment view; `${VAULT:…}` references resolve against it before the process environment. Keeps secrets out of the container env (`docker inspect`, `/proc/1/environ`, the terminal tool's `env`). Set but unreadable is **fatal at boot** — a secretless boot would silently skip every skill that needs one. |

## Postures

Security enforcement activates by posture (`standard` → `hardened` →
`regulated`) with no semantic change or data migration; bookkeeping is
always on. The posture model and what each level enables are specified in
the [TDD](../explanation/elliott-tdd.md); CI runs the test suite across
all three postures.
