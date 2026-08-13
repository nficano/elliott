# Configuration

The runtime reads two files at the config boundary. No other module reads
`process.env`; a lint rule enforces that.

| File | Contents |
| :--- | :--- |
| `config/elliott.yaml` | runtime configuration |
| `config/secrets.yaml` | flat map of secret name to opaque reference |

## Reference syntax

Values in either file are literals or opaque references.

| Form | Resolves against |
| :--- | :--- |
| `${ENV:VAR}` | process environment, including the `ELLIOTT_SECRETS_FILE` overlay |
| `${VAULT:<mount/path>#<field>}` | HashiCorp Vault KV |

An unresolvable reference in `config/elliott.yaml` is fatal at boot and names
the missing variable or field. In `config/secrets.yaml` it is omitted, and the
skills depending on it stay unregistered.

## Required fields

No LLM provider, endpoint, model, or key ships as a default.

| Field | Shipped default | Meaning |
| :--- | :--- | :--- |
| `llm.provider` **or** `llm.base_url` | `${ENV:ELLIOTT_LLM_PROVIDER}` | see [Choosing an endpoint](#choosing-an-endpoint) — exactly one is required |
| `llm.api_key` | `${ENV:ELLIOTT_LLM_API_KEY}` | credential for that endpoint |
| `llm.models.<tier>.model` | `${ENV:ELLIOTT_LLM_MODEL}` | model id for the tier the agent selects |
| `runtime.timezone` | `UTC` | runtime timezone |
| agent `spec.persona` | path | persona prompt file |
| agent `spec.modelProfile` | `default` | which `llm.models` tier this agent uses |

A missing one fails the boot naming it, as
`Environment is missing ELLIOTT_LLM_PROVIDER` or
`Missing configuration: llm.models.default.model`. Setting neither `provider`
nor `base_url` fails naming both.

Every other block is optional. An absent block disables its feature, with one
exception noted under `observability`.

## `config/elliott.yaml`

| Section | Purpose |
| :--- | :--- |
| `runtime` | `timezone`, `http.port` |
| `store` | external Postgres `dsn`, `pool.max`, `vectors`; absent `dsn` selects embedded SQLite |
| `llm` | `base_url`, `api_key`, `max_parallel`, model tiers, profiles |
| `budgets` | `cold_tokens_max`, `monthly_usd_max`, `per_turn_usd_max` |
| `observability` | Sentry-compatible error reporting |
| `notify` | `webhook_url`, `default_channels` |
| `tools` | per-tool enablement and allowlists |
| `channels` | gateway enablement |
| `gateways` | gateway-specific settings |
| `governance` | `deny: [toolName, …]` |
| `skills` | per-skill settings |
| `install` | registry skills to install |

### `llm`

Agents select a tier by name through `spec.modelProfile`, never a provider model
id.

```yaml
llm:
  provider: ${ENV:ELLIOTT_LLM_PROVIDER} # anthropic | openai
  # base_url: ${ENV:ELLIOTT_LLM_BASE_URL}
  api_key: ${ENV:ELLIOTT_LLM_API_KEY}
  max_parallel: 12
  models:
    default:
      model: ${ENV:ELLIOTT_LLM_MODEL}
      context_window: 128000
  profiles:
    default: { max_tokens: 4096, temperature: 0.4 }
```

#### Choosing an endpoint

`provider` and `base_url` resolve to one concrete URL and one wire protocol.

| Config | Endpoint | Wire |
| :--- | :--- | :--- |
| `provider: anthropic` | `https://api.anthropic.com/v1` | native `/messages` |
| `provider: openai` | `https://api.openai.com/v1` | `/chat/completions` |
| `base_url: <url>` alone | that URL | `/chat/completions` |
| both | `base_url` | the provider's wire |

Naming a provider is what makes a bare key sufficient — you no longer have to
know the vendor's URL. Setting `base_url` alone keeps every pre-provider config
working unchanged: a LiteLLM proxy, Ollama, or any vendor `/v1` is an
OpenAI-compatible endpoint. Setting both means "this provider's protocol, my
host", for a gateway that speaks Anthropic on a private URL.

elliott never infers the provider from the API key's prefix or the model's
name. A wrong guess would send prompts to a vendor the operator did not choose,
so an unset pair is a boot failure naming both keys rather than a default.

The two wires are not interchangeable. The native Anthropic wire sends
`x-api-key` with a pinned `anthropic-version` and the content-block message
shape, and it is the only one that carries `thinking` and `effort`. It also
omits `temperature`: current Anthropic models removed the sampling parameters
and reject any of them with a 400, so that setting applies to the OpenAI wire
only.

#### Reasoning controls

`thinking` and `effort` are optional keys on `llm.profiles.default`. Unset
leaves each model's own default in force — the only setting that stays correct
as those defaults change per model. An unrecognized value fails at boot rather
than on every turn.

| Key | Values | Reaches |
| :--- | :--- | :--- |
| `thinking` | `adaptive`, `disabled` | Anthropic wire, as a `thinking` block |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max` | Anthropic `output_config.effort`; OpenAI `reasoning_effort` |

```yaml
llm:
  profiles:
    default: { max_tokens: 4096, thinking: adaptive, effort: high }
```

Two things worth knowing before turning these on. `max_tokens` caps thinking
*plus* the reply, so a budget tuned for a non-thinking model can truncate the
answer once thinking is on. And current Anthropic models reject `disabled`
thinking above `high` effort — elliott passes that pairing through and surfaces
the provider's own 400, rather than encoding a per-model rule that would rot.

### `observability`

The `glitchtip` skill is enabled by default. An absent `observability` block
leaves error reporting on, which is the one exception to absent-block-disables.

```yaml
observability:
  glitchtip:
    enabled: true
    # dsn: ${ENV:ELLIOTT_GLITCHTIP_DSN}
```

DSN precedence: an explicit `glitchtip.dsn`, then the `ELLIOTT_GLITCHTIP_DSN`
environment variable, then the bundled loopback collector. Unlike a `${ENV:…}`
reference, an unset `ELLIOTT_GLITCHTIP_DSN` is not fatal. A present but empty or
non-string `dsn` is rejected at boot.

Transmitted payloads carry the error class, its stack frames, and the mechanism.
The error message stays in the local console and never crosses the process
boundary, so no interpolated secret can appear in a transmitted payload.

### `tools`

```yaml
tools:
  files:
    enabled: true
    root: .elliott-runtime/workspace
  terminal:
    enabled: false
    root: .elliott-runtime/workspace
    allowed_commands: []
  ssh:
    enabled: false
    user: elliott
    hosts: []
  vault:
    enabled: false
    address: ""
    paths: []
```

`allowed_commands`, `hosts`, and `paths` fail closed. An empty list leaves the
tool unregistered even with `enabled: true`. The `files` tool checks for symlink
escape on every read and write. The `vault` tool additionally requires a
`vault_token` secret and reads only its allowlisted paths, given as full KV v2
API paths such as `secret/data/myapp`.

## `config/secrets.yaml`

```yaml
ssh_private_key: ${ENV:ELLIOTT_SSH_PRIVATE_KEY}
brave_api_key: ${VAULT:secret/data/example#brave_api_key}
```

Secrets resolve only at the config boundary, only at boot. An unresolvable
reference is omitted rather than fatal. Which skills that leaves dormant is
listed in [Activation gates](activation-gates.md).

## Environment

| Variable | Required | Default |
| :--- | :--- | :--- |
| `ELLIOTT_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | as shipped, yes | none |
| `ELLIOTT_HTTP_PORT` | no | `runtime.http.port`, else `8080` |
| `ELLIOTT_ENV` | no | `prod` |
| `ELLIOTT_RELEASE` | no | `dev` |
| `ELLIOTT_SECRETS_FILE` | no | none |
| `ELLIOTT_GLITCHTIP_DSN` | no | bundled loopback collector |
| `ELLIOTT_GOVERNANCE_TOKEN` | no | none; opens `/v1/control/governance` |
| `ELLIOTT_EVOLUTION_CONTROL_TOKEN` | no | none |
| `ELLIOTT_EVOLUTION_OPERATOR_PRINCIPAL` | no | none |
| `ELLIOTT_EVOLUTION_OPERATOR_CAPABILITIES` | no | none |
| `ELLIOTT_TELEMETRY_PROMPTS` | no | on; `"0"` withholds prompt text from the live feed |
| `ELLIOTT_CONTROL_PLANE_URL` / `_TOKEN` | CLI only | none |
| `GITHUB_TOKEN` | no | none; used when installing registry skills |

All three `ELLIOTT_EVOLUTION_*` variables are required together to open
`/v1/control/evolution`.

`ELLIOTT_SECRETS_FILE` names a mounted JSON object whose entries join the
boundary's environment view; `${ENV:…}` references resolve against it before the
process environment. Set but unreadable, or holding anything other than a JSON
object, is fatal at boot.

`ELLIOTT_ENV` and `ELLIOTT_RELEASE` are read from the ambient environment only,
never from the secrets-file overlay, because both ride in every outbound error
envelope.

## Postures

`standard`, `hardened`, and `regulated`. Bookkeeping runs at every level;
enforcement widens as the posture rises, with no semantic change and no data
migration.

Posture is a constructor argument, not configuration. `AgentKernel` takes
`options.posture` and defaults to `standard`
([`src/kernel.ts:72`](../../src/kernel.ts#L72)). There is no key for it in
`config/elliott.yaml`.

`ELLIOTT_POSTURE` is set by the CI matrix
([`ci.yml:26`](../../.github/workflows/ci.yml#L26)) and no code reads it, so the
three matrix jobs currently execute identical paths. Treat the variable as
reserved rather than functional.
