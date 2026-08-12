# Configuration reference

The production runtime reads two files at the config boundary. No other
module reads `process.env` — that is a lint-enforced rule.

- `config/elliott.yaml` — runtime configuration
- `config/secrets.yaml` — a flat map of secret names to opaque references

Values in either file may be literals or opaque references:
`${ENV:VAR}` (process environment, including the `ELLIOTT_SECRETS_FILE`
mount) or `${VAULT:<mount/path>#<field>}` (HashiCorp Vault KV). In
`config/elliott.yaml` an unresolvable reference is **fatal at boot**, naming
the missing variable or field. In `config/secrets.yaml` it is omitted, not
fatal (see below).

## Required configuration

The repo ships no LLM endpoint, model, or API key. These fields are required
and env-backed by default; a missing one fails the boot with an error naming
it (`Environment is missing ELLIOTT_LLM_BASE_URL`, `Missing configuration:
llm.models.default.model`, …):

| Field | Default source | Meaning |
| :---- | :------------- | :------ |
| `llm.base_url` | `${ENV:ELLIOTT_LLM_BASE_URL}` | any OpenAI-compatible endpoint (`…/v1`) |
| `llm.api_key` | `${ENV:ELLIOTT_LLM_API_KEY}` | bearer for that endpoint |
| `llm.models.<tier>.model` | `${ENV:ELLIOTT_LLM_MODEL}` | model id for the tier the agent selects |
| `runtime.timezone` | literal (`UTC`) | runtime timezone |
| agent `spec.persona` | literal path | persona prompt file |
| agent `spec.modelProfile` | literal (`default`) | which `llm.models` tier this agent uses |

Everything else is optional; absent blocks disable their feature.

## `config/elliott.yaml`

Top-level sections:

| Section         | Purpose                                                       |
| :-------------- | :------------------------------------------------------------ |
| `runtime`       | `timezone`, `http.port`                                       |
| `store`         | optional external Postgres (`dsn`), `pool.max`, `vectors`; absent `dsn` ⇒ embedded SQLite |
| `llm`           | `base_url`, `api_key`, `max_parallel`, model tiers, profiles  |
| `budgets`       | `cold_tokens_max`, `monthly_usd_max`, `per_turn_usd_max`      |
| `observability` | Sentry-compatible error reporting via `glitchtip`, **on by default** (see below); `enabled: false` ⇒ console-only |
| `notify`        | `webhook_url`, `default_channels`                             |
| `tools`         | per-tool enablement + allowlists (below)                      |
| `channels`      | gateway enablement (email, bluebubbles, home_assistant, …)    |
| `gateways`      | gateway-specific settings (e.g. `cloudflared.ready_url`)      |
| `skills`        | per-skill settings (e.g. `deep_trace.public_hostname`)        |
| `install`       | registry skills to install (see the [registry guide](../guides/install-registry-skills.md)) |

### `llm`

Model selection is by tier, never by hardcoded provider model name in agent
code. Agents select a tier via `spec.modelProfile`; add tiers as your
deployment needs:

```yaml
llm:
  base_url: ${ENV:ELLIOTT_LLM_BASE_URL} # e.g. https://api.example.com/v1
  api_key: ${ENV:ELLIOTT_LLM_API_KEY}
  max_parallel: 12
  models:
    default:
      model: ${ENV:ELLIOTT_LLM_MODEL}
      context_window: 128000
    # fast:     { model: provider/small-model,  context_window: 200000 }
    # standard: { model: provider/medium-model, context_window: 200000 }
    # deep:     { model: provider/large-model,  context_window: 200000 }
  profiles:
    default: { max_tokens: 4096, temperature: 0.4 }
```

### `observability` (error reporting, on by default)

The `glitchtip` skill (core) is **enabled by default** and needs no setup:
errors always log to the console, and with the bundled collector companion
(`deploy/compose.glitchtip.yml`) they also ship to a Sentry-compatible
collector — the one exception to "absent block ⇒ feature off", since an absent
`observability` block leaves reporting on.

```yaml
observability:
  glitchtip:
    enabled: true                      # default; `false` ⇒ console-only, nothing loads
    # dsn: ${ENV:ELLIOTT_GLITCHTIP_DSN} # your own Sentry/GlitchTip (see below)
```

DSN precedence: an explicit `glitchtip.dsn` wins, else the
`ELLIOTT_GLITCHTIP_DSN` environment variable (read directly at the config
boundary — unlike a `${ENV:…}` reference it is **not** fatal when unset), else
the bundled loopback collector. So a stock boot reports to the companion; set
either to point at your own instance. The DSN and any Vault token/path are
redacted out of captured error payloads, never transmitted.

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
  vault:
    enabled: false                     # HashiCorp Vault KV v2 reads, off by default
    address: ""                        # e.g. https://vault.internal:8200
    paths: []                          # empty ⇒ tool does not register (fail-closed)
```

A tool with `enabled: true` but an empty allowlist still registers
nothing. See [Enable terminal and SSH](../guides/enable-terminal-and-ssh.md).
The `vault` tool additionally needs a `vault_token` secret (below) and reads
only the allowlisted `paths` (full KV v2 API paths, e.g. `secret/data/myapp`).

## `config/secrets.yaml`

A flat map from secret name to an opaque reference:

```yaml
ssh_private_key: ${ENV:ELLIOTT_SSH_PRIVATE_KEY}
brave_api_key: ${VAULT:secret/data/example#brave_api_key}
```

Rules:

- Secrets are resolved **only** at the config boundary, at boot.
- A reference that does not resolve is **omitted, not fatal**: the skills
  that need it stay unregistered while the rest of the runtime starts.
  Current dormant-by-provisioning components are listed in
  [activation status](blockers.md).
- Never hardcode a secret value, log one, or interpolate one into an error
  message that leaves the process.

## Environment

| Variable      | Effect                                    |
| :------------ | :---------------------------------------- |
| `ELLIOTT_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | fill the required `llm` fields above (referenced from the shipped config) |
| `ELLIOTT_ENV` | `dev` selects development behavior (`bun run dev`) |
| `ELLIOTT_HTTP_PORT` | overrides `runtime.http.port` for local runs |
| `ELLIOTT_CONTROL_PLANE_URL` / `_TOKEN` | evolution CLI only — see [CLI](cli.md) |
| `ELLIOTT_SECRETS_FILE` | path to a mounted JSON object whose entries join the boundary's environment view; `${VAULT:…}` references resolve against it before the process environment. Keeps secrets out of the container env (`docker inspect`, `/proc/1/environ`, the terminal tool's `env`). Set but unreadable is **fatal at boot** — a secretless boot would silently skip every skill that needs one. |

## Postures

Security enforcement activates by posture (`standard` → `hardened` →
`regulated`) with no semantic change or data migration; bookkeeping is
always on. The posture model and what each level enables are specified in
the [TDD](../explanation/elliott-tdd.md); CI runs the test suite across
all three postures.
