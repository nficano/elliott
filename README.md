# elliott

A TypeScript framework for composing personal AI agents, where every capability
(tool, gateway, MCP endpoint, memory provider, evaluator) is one primitive: the
Component.

You supply a YAML config and a directory of skill packages. Elliott boots an HTTP
server, loads each package's `register()`, exposes the resulting tools to an
OpenAI-compatible model, and runs a tool-calling loop that frames every tool
result as `[UNTRUSTED TOOL OUTPUT]`
([src/runtime/agent.ts:150](src/runtime/agent.ts#L150)). Enforcement sits outside
the model: capability grants, fail-closed allowlists, a durable audit log.

Elliott is not itself a deployable app; its CI only tests
([ci.yml:49-52](.github/workflows/ci.yml#L49-L52)). What you deploy is a consumer
agent repository that installs elliott as a package and boots `ElliottRuntime`
against its own `agentRoot`.

## Install

Bun 1.3.8 (the version CI and the Dockerfile pin) and Git.

```bash
git clone git@github.com:nficano/elliott.git && cd elliott
bun install                        # also installs .githooks via `prepare`

# or, as a dependency of your own agent repository:
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git"
bunx elliott new agent my-agent    # scaffolds main.ts, agents/, config/
```

## Usage

No LLM endpoint or model ships as a default. The shipped `config/elliott.yaml`
reads these three, and the boot fails naming whichever is missing:

```bash
export ELLIOTT_LLM_BASE_URL="https://api.example.com/v1"
export ELLIOTT_LLM_API_KEY="sk-…"
export ELLIOTT_LLM_MODEL="your-model-id"

bun run start                     # bun src/runtime/main.ts; serves until SIGINT
curl -s localhost:8080/healthz    # from a second shell
```

```json
{"ready":true,"release":"dev","skills":23,"tools":7,
 "gateways":{"deep-trace":"active"},
 "services":{"deep-trace":{"turns":0,"events":3,"clients":0,"dbTables":12},
             "glitchtip":{"queued":0,"sent":0,"dropped":0},"scheduler":{}}}
```

`GET /v1/components` lists what loaded. All 23 bundled packages load; 7 tools
register on a stock config, and the rest stay dormant until you supply their
secret or enable flag ([docs/reference/blockers.md](docs/reference/blockers.md)).

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

`src/loop/` and `src/kernel.ts` are the canonical layer, exported for consumers;
nothing under `src/runtime/` imports them.

<details>
<summary>Request lifecycle</summary>

1. A gateway or a skill-registered HTTP route receives the message.
   `resolveRuntimeRoute` dispatches health, components, the two control-plane
   paths, then the skill route table
   ([app.ts:97-119](src/runtime/app.ts#L97-L119)).
2. `#handleInbound` dedupes by message id, keys a conversation on
   `gateway:channel:thread`, rejects a second concurrent turn on it, and pins the
   Snapshot id it started on ([app.ts:487](src/runtime/app.ts#L487)).
3. `RuntimeAgent.turn` loops up to 8 rounds, assembling persona + fixed security
   framing + time each round ([agent.ts:203](src/runtime/agent.ts#L203)).
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
`observability`, `notify`, `tools`, `skills`, `install`; `config/secrets.yaml` is
a flat map of secret name to opaque reference. Values may be literals,
`${ENV:VAR}`, or `${VAULT:mount/path#field}`. An unresolvable reference in
`elliott.yaml` is fatal at boot; in `secrets.yaml` it is omitted and the skills
needing it stay unregistered
([config.ts:394-419](src/runtime/config.ts#L394-L419)).

A first-time user sets `llm.base_url`, `llm.api_key`, and one model tier under
`llm.models`. Agents select a tier by name via `spec.modelProfile`, never a
provider model id. Tool allowlists fail closed: `terminal.allowed_commands`,
`ssh.hosts`, and `vault.paths` each leave their tool unregistered when empty.

<details>
<summary>Environment variables the code reads</summary>

| Name | Required | Default |
| :--- | :------- | :------ |
| `ELLIOTT_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | yes, as shipped | none |
| `ELLIOTT_HTTP_PORT` | no | `runtime.http.port`, else `8080` |
| `ELLIOTT_ENV` / `ELLIOTT_RELEASE` | no | `prod` / `dev` |
| `ELLIOTT_SECRETS_FILE` | no | none; a JSON object overlaid on the env view, and set-but-unreadable fails the boot |
| `ELLIOTT_GLITCHTIP_DSN` | no | the bundled loopback collector |
| `ELLIOTT_GOVERNANCE_TOKEN` | no | none; opens `/v1/control/governance` |
| `ELLIOTT_EVOLUTION_CONTROL_TOKEN` + `_OPERATOR_PRINCIPAL` + `_OPERATOR_CAPABILITIES` | no | none; all three needed to open `/v1/control/evolution` |
| `ELLIOTT_TELEMETRY_PROMPTS` | no | on; `"0"` withholds prompt text from the live feed |
| `ELLIOTT_CONTROL_PLANE_URL` / `_TOKEN` | CLI only | none |
| `GITHUB_TOKEN` | no | none; used when installing registry skills |

`ELLIOTT_ENV` and `ELLIOTT_RELEASE` come from the ambient environment only, never
the secrets-file overlay, because both ride in every outbound error envelope
([config.ts:94-104](src/runtime/config.ts#L94-L104)). Full key list:
[docs/reference/configuration.md](docs/reference/configuration.md).

</details>

## Extension points

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

## Architecture

One Bun process, `bun src/runtime/main.ts`, serving `Bun.serve` on port 8080
(`EXPOSE 8080` in the [Dockerfile](Dockerfile)); gateways and background services
run inside it. Optional pieces:

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

[deploy/compose.yml](deploy/compose.yml) describes the canonical isolated
topology (kernel, audit, component pool, provider pool on internal-only
networks), which
[g21-topology-container.test.ts](test/conformance/g21-topology-container.test.ts)
checks against. No Dockerfile here builds those images.

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
`cargo clippy -D warnings` and runs the suite three times with `ELLIOTT_POSTURE`
set to `standard`, `hardened`, `regulated`. Conformance gates G1–G26 sit
one-per-file in [test/conformance/](test/conformance/), each mapping to a section
of [docs/explanation/elliott-tdd.md](docs/explanation/elliott-tdd.md).

## Troubleshooting

<details>
<summary>Failures the code raises by name</summary>

**`error: Environment is missing ELLIOTT_LLM_BASE_URL`**: a `${ENV:…}` reference
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

[docs/index.md](docs/index.md) is the landing page, organized by reader intent;
[elliott-tdd.md](docs/explanation/elliott-tdd.md) is the authority for every
invariant.

TODO: no file outside `.github/workflows/ci.yml` reads `ELLIOTT_POSTURE`. Verify
whether the three matrix jobs exercise different code paths.

TODO: nothing in this repo builds the four images `deploy/compose.yml` names
(`elliott/kernel`, `-audit`, `-component-pool`, `-provider-pool`). Confirm
whether that file is topology-only.
