<div align="center">

# elliott

**A security-first TypeScript framework for composing personal AI agents.**

[![CI](https://github.com/nficano/elliott/actions/workflows/ci.yml/badge.svg)](https://github.com/nficano/elliott/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Bun 1.3.8](https://img.shields.io/badge/bun-1.3.8-F9F1E1?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

[Documentation](docs/index.md) · [Tutorials](docs/tutorials/run-your-first-agent.md) · [Architecture](docs/explanation/architecture.md) · [Contributing](CONTRIBUTING.md)

</div>

---

Every capability an agent has, whether a tool, gateway, MCP endpoint, memory
provider, or evaluator, is one primitive: the Component.

You supply a YAML config and a directory of skill packages. elliott boots an
HTTP server, loads each package's `register()`, exposes the resulting tools to
an OpenAI-compatible model, and runs a tool-calling loop that frames every tool
result as `[UNTRUSTED TOOL OUTPUT]`
([src/runtime/agent.ts:150](src/runtime/agent.ts#L150)). Enforcement sits
outside the model: capability grants, fail-closed allowlists, a durable audit
log.

## Why

A personal agent runs untrusted content through powerful tools on your behalf.
That is a security problem wearing a productivity costume, and elliott treats it
as one:

- **No ambient authority.** Components get scoped handles and brokered grants,
  never the host environment.
- **Inference is not authorization.** A model may suggest an action. It cannot
  grant a permission or route around the capability broker.
- **Untrusted evidence, never instructions.** Tool and gateway output enters the
  loop framed, and never gains instruction precedence.
- **Allowlists fail closed.** A skill with no allowlist registers nothing rather
  than registering something permissive.

The full reasoning: [The security model](docs/explanation/security-model.md).

## Install

Requires [Bun](https://bun.sh) 1.3.8 (the version CI and the Dockerfile pin) and
Git.

```bash
# work on elliott itself
git clone git@github.com:nficano/elliott.git && cd elliott
bun install                        # also installs .githooks via `prepare`

# or consume it from your own agent repository
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git"
bunx elliott new agent my-agent    # scaffolds main.ts, agents/, config/
```

elliott is not itself a deployable app; its CI only tests. What you deploy is an
agent repository that installs elliott as a package and boots `ElliottRuntime`
against its own `agentRoot`. See
[Create an agent repository](docs/guides/create-an-agent-repo.md).

## Quick start

No LLM provider, key, or model ships as a default. The shipped
`config/elliott.yaml` reads these three, and the boot fails naming whichever is
missing:

```bash
export ELLIOTT_LLM_PROVIDER="anthropic"   # or: openai
export ELLIOTT_LLM_API_KEY="sk-ant-…"
export ELLIOTT_LLM_MODEL="claude-haiku-4-5-20251001"

bun run start                     # serves until SIGINT
curl -s localhost:8080/healthz    # from a second shell
```

```json
{"ready":true,"release":"dev","skills":23,"tools":7,
 "gateways":{"deep-trace":"active"},
 "services":{"deep-trace":{"turns":0,"events":3,"clients":0,"dbTables":12},
             "glitchtip":{"queued":0,"sent":0,"dropped":0},"scheduler":{}}}
```

Naming a provider resolves its endpoint and wire protocol for you. To run
against anything else, a LiteLLM proxy, Ollama, another vendor's `/v1`, set
`llm.base_url` in your copy of `config/elliott.yaml` instead (its line is
commented by default) and export `ELLIOTT_LLM_BASE_URL`. Exporting
`ELLIOTT_LLM_BASE_URL` without uncommenting that line does nothing, since the
shipped config never reads it. See the
[`llm` reference](docs/reference/configuration.md#llm).

All 23 bundled packages load. Only 7 tools register, because the rest stay
dormant until you supply their secret or flip their flag. That gap is the design
working: see [Activation gates](docs/reference/activation-gates.md).

Walk it end to end in
[Run your first agent](docs/tutorials/run-your-first-agent.md).

## Concepts

| Name | What it is | Where |
| :--- | :--------- | :---- |
| Component | Universal primitive: identity, kind, version, digest, manifest, protocols, capabilities, lifecycle | [src/core/types.ts](src/core/types.ts) |
| Protocol | Narrow schema-backed behavior a component implements (`tool.executor`, `message.sink`, …) | [src/core/types.ts:81](src/core/types.ts#L81) |
| Grant | Brokered, epoch-checked authority; revocation bites on the next call | [src/security/grants/](src/security/grants/) |
| AgentKernel | Assembles registry, broker, audit log, epochs, placement, model dispatcher | [src/kernel.ts](src/kernel.ts) |
| Posture | `standard` / `hardened` / `regulated`; each widens the classification lattice and turns on residency filtering and the sanitizer | [src/config/postures/index.ts](src/config/postures/index.ts) |
| Skill package | `manifest.yaml` + `SKILL.md` + optional `src/` exporting `register()` | [skills/](skills/) |
| Facility | Infrastructure one skill provides to another (proxy routes, webhook ingress), acquired during `register()` | [src/runtime/skills/types.ts:81-118](src/runtime/skills/types.ts#L81-L118) |
| ElliottRuntime | The process that boots in production: HTTP server, skill loader, gateways, agent loop | [src/runtime/app.ts](src/runtime/app.ts) |

`src/loop/` and `src/kernel.ts` are the canonical layer, exported for consumers.
Nothing under `src/runtime/` imports them. That split is the thing to understand
first: [Architecture](docs/explanation/architecture.md).

<details>
<summary><b>Request lifecycle</b></summary>

1. A gateway or a skill-registered HTTP route receives the message.
   `resolveRuntimeRoute` dispatches health, components, the two control-plane
   paths, then the skill route table
   ([app.ts:97-119](src/runtime/app.ts#L97-L119)).
2. `#handleInbound` dedupes by message id, keys a conversation on
   `gateway:channel:thread`, rejects a second concurrent turn on it, and pins
   the Snapshot id it started on ([app.ts:487](src/runtime/app.ts#L487)).
3. `RuntimeAgent.turn` loops up to 8 rounds, assembling persona, fixed security
   framing, and time each round ([agent.ts:203](src/runtime/agent.ts#L203)).
4. Tool calls run through `ToolGovernor` (policy check, attribution, durable
   audit record) and, for `ssh_exec`, through `CapabilityGate` against the real
   `CapabilityBroker` with a grant scoped to the configured host allowlist
   ([app.ts:327-369](src/runtime/app.ts#L327-L369)).
5. Results are truncated to 30,000 characters and prefixed
   `[UNTRUSTED TOOL OUTPUT]`. A third identical call in one turn gets a runtime
   notice prepended ahead of that marker
   ([agent.ts:230-243](src/runtime/agent.ts#L230-L243)).
6. The reply goes back through the originating gateway if it can send, else the
   primary gateway ([app.ts:132](src/runtime/app.ts#L132)).

</details>

## Configuration

Two files at the config boundary, and a lint rule stops any other module reading
`process.env`. `config/elliott.yaml` holds `runtime`, `store`, `llm`, `budgets`,
`observability`, `notify`, `tools`, `skills`, `install`; `config/secrets.yaml`
is a flat map of secret name to opaque reference. Values may be literals,
`${ENV:VAR}`, or `${VAULT:mount/path#field}`. An unresolvable reference in
`elliott.yaml` is fatal at boot; in `secrets.yaml` it is omitted and the skills
needing it stay unregistered
([config.ts:394-419](src/runtime/config.ts#L394-L419)).

Tool allowlists fail closed. `terminal.allowed_commands`, `ssh.hosts`, and
`vault.paths` each leave their tool unregistered when empty.

Every key, and every environment variable the code reads:
[Configuration reference](docs/reference/configuration.md).

## Extending it

A skill package's `src/` exports one `register(ctx: SkillContext)` returning up
to five kinds of binding:

```typescript
export interface SkillRegistration {
  readonly tools?: readonly ToolDefinition[];
  readonly gateways?: readonly GatewayBinding[];
  readonly routes?: readonly RouteBinding[];
  readonly services?: readonly ServiceBinding[];
  readonly facilities?: readonly FacilityBinding[];
}
```

Packages declaring `spec.provides` register first, so consumers can acquire
facility grants inside their own `register()`
([loader.ts:22-49](src/runtime/skills/loader.ts#L22-L49)). A `register()` that
throws is reported and boot continues degraded, which is why every skill needs a
smoke test under [test/integration/skills/](test/integration/skills/).

[skills/fetch](skills/fetch) is the whole shape: `src/index.ts` returns one tool,
`manifest.yaml` carries the authority half (`capabilities`, `egress`,
`isolation: container`, `outputTrust: untrusted`), `SKILL.md` the model-visible
description.

Build one in
[Build your first skill](docs/tutorials/build-your-first-skill.md).

## Architecture

One Bun process, `bun src/runtime/main.ts`, serving `Bun.serve` on port 8080
(`EXPOSE 8080` in the [Dockerfile](Dockerfile)). Gateways and background
services run inside it. Optional pieces:

- A Rust N-API addon (`native/hot-core`) for the linear-DFA scanner, built by
  `bun run hot-core:build` and compiled from `rust:1.92-alpine` in the
  Dockerfile. Absent, the TypeScript scanner takes over.
- A Sentry-compatible collector as a loopback sidecar sharing the app's network
  namespace ([deploy/compose.glitchtip.yml](deploy/compose.glitchtip.yml)).
- Placement sidecars under [deploy/placement/](deploy/placement/): the model
  proxy holds the upstream credential a sealed evolution companion must never
  see; the bridge pipes into a companion that binds only `127.0.0.1`. The
  companions themselves live in [darwin/](darwin/).
- External MCP servers declared in `agents/<name>/agent.yaml` under `spec.mcp`.

[deploy/compose.yml](deploy/compose.yml) is a topology declaration, not a
runnable stack. It names four images (`elliott/kernel`, `-audit`,
`-component-pool`, `-provider-pool`), carries no `build:` keys, and nothing in
this repository builds them. It exists so
[g21-topology-container.test.ts](test/conformance/g21-topology-container.test.ts)
can assert the isolated topology.

## Development

| Command | Checks |
| :------ | :----- |
| `bun test` | the full suite: unit, integration, conformance, fuzz |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint:strict` | eslint at zero warnings, plus custom rules keeping named type declarations inside `types.ts` modules and banning direct `process.env` access |
| `bun run format:check` | dprint |
| `bun run ratchet:check` | the coverage floors in `scripts/coverage-gate.ts` were not lowered against the merge base |
| `bun run test:coverage` | suite + weighted aggregate ≥ 80% lines and functions |
| `bun run unicode:check` | bidi and zero-width characters in tracked text (Trojan Source) |
| `bun run workflows:check` | `pull_request_target` checking out PR head; PR jobs on self-hosted runners |
| `bun run footprint:check` | prompt footprint against `config/footprint-budgets.json` |
| `bun run hot-core:check` | cargo tests, addon build, native-backend assertion, fuzz suite |
| `bun run darwin:check` | bun + python tests and JSON fixture parses under `darwin/` |
| `bun run check` | all of the above |

Pre-push runs `ratchet:check`, `lint:strict`, and `test:coverage`
([.githooks/pre-push](.githooks/pre-push)); CI adds `cargo fmt` and
`cargo clippy -D warnings`. Gates only ratchet, and gate files are protected
from automated edits: [Quality gates](docs/reference/quality-gates.md).

Conformance gates G1 through G26 sit one per file in
[test/conformance/](test/conformance/) and are the authority for every
invariant. A design claim with no gate behind it is not an invariant. Index:
[Conformance gates](docs/reference/conformance-gates.md).

<details>
<summary><b>Troubleshooting: failures the code raises by name</b></summary>

**`error: Environment is missing ELLIOTT_LLM_PROVIDER`**: a `${ENV:…}` reference
in `config/elliott.yaml` did not resolve. Export the variable, or replace the
expression with a literal in your agent repo's copy. The sibling
`Missing configuration: llm.models.default.model` means the tier named by
`spec.modelProfile` has no `model` key.

**`ELLIOTT_SECRETS_FILE <path> is unreadable`** / **`must hold a JSON object`**:
the mount is set but the file is missing or is not a JSON object. Booting
secretless would skip every skill needing a secret, so this fails loudly.

**`Native hot-core addon did not load`** from `hot-core:check`: no Rust
toolchain, or the addon was never built. Run `bun run hot-core:build`. The
runtime does not need it; only the gate does.

**`Failed to start server. Is port 8080 in use?`**: something else holds the
default port. Set `ELLIOTT_HTTP_PORT` for the run, or change
`runtime.http.port`.

**`/healthz` returns 503 with `ready:false`**: the server is still booting, or a
skill marked `required` in the `install:` block failed. The `install` array in
the body names it.

</details>

## Documentation

[docs/index.md](docs/index.md) is the landing page, organized by reader intent
following [Diátaxis](https://diataxis.fr):

- **[Tutorials](docs/tutorials/run-your-first-agent.md)** — learning by doing
- **[How-to guides](docs/index.md#how-to-guides)** — one task per page
- **[Reference](docs/index.md#reference)** — config, CLI, HTTP, APIs, gates
- **[Explanation](docs/index.md#explanation)** — architecture and design reasoning

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), then
[Set up a development environment](docs/guides/set-up-a-development-environment.md).

Behavior changes update the matching documentation quadrant in the same pull
request. New code needs tests that keep the coverage aggregate at or above the
floors, and the floors only move up. Gate failures get fixed in the code, not in
the gate.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md)
for the disclosure process.

## License

[MIT](LICENSE) © Nick Ficano
