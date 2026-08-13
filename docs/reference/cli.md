# CLI

The `elliott` binary is declared as `bin.elliott` in `package.json`, resolving
to [`src/cli.ts`](../../src/cli.ts). Invoke it as `bunx elliott …` from a
consumer repository, or `bun src/cli.ts …` inside this one.

Argument handling is ordered: scaffolding claims the invocation first, then
`doctor`, then `skills`, then everything else falls through to the evolution
control plane.

## `elliott new`

```
elliott new skill <name> [directory]
elliott new tool  <name> [directory]
elliott new agent <name> [directory]
```

| Argument | Constraint |
| :--- | :--- |
| `<name>` | lowercase letters, digits, hyphens; 64 characters maximum |
| `[directory]` | parent directory; defaults to `.` |

`skill` and `tool` scaffold a component package: manifest overlay, kind
document, conformance test. `agent` scaffolds a consumer agent repository:
`main.ts`, `agents/<name>/agent.yaml`, a persona file, and `config/elliott.yaml`
plus `config/secrets.yaml` with env-backed placeholders for the required LLM
fields.

Prints the created directory on success.

## `elliott doctor`

```
elliott doctor
```

An out-of-box end-to-end check: boots the skills, reports which registered and
which stayed dormant, then runs one live model round-trip against the configured
provider. Meant for a fresh clone — set the LLM keys and watch it work.

It checks the deployment in your **current working directory**: the config,
agent definition, secrets mapping, and agent-local skills all load from there,
while the bundled framework skills load from the elliott package. Running it
inside this repo, the two coincide; running `bunx elliott doctor` from a consumer
repo that boots elliott as a package, it validates the consumer's config, not the
framework's. The agent name defaults to `elliott`; set `ELLIOTT_AGENT_NAME` when
the deployment's agent is named otherwise.

Minimal config. The command needs only an LLM credential, resolved in this
order:

| Precedence | Variables | Model |
| :--- | :--- | :--- |
| explicit | `ELLIOTT_LLM_PROVIDER` + `ELLIOTT_LLM_API_KEY` + `ELLIOTT_LLM_MODEL` | as set |
| convenience | `ANTHROPIC_API_KEY` (implies `anthropic`) | a built-in default, override with `ELLIOTT_LLM_MODEL` |
| convenience | `OPENAI_API_KEY` (implies `openai`) | a built-in default, override with `ELLIOTT_LLM_MODEL` |

With none of these set it prints the variable the loaded config is missing plus
how to supply it, and exits non-zero. The shipped `config/elliott.yaml` reads a
provider; to run against an OpenAI-compatible `base_url`, set `llm.base_url`
there (its line is commented by default) — the doctor then loads whatever that
config requires. `ELLIOTT_LLM_BASE_URL` alone does nothing against the shipped
config.

The output has four parts:

- **LLM probe** — `OK` or `FAILED`, with the wire, model, and endpoint. A
  failure prints the provider's own message (e.g. `Anthropic 401: …`), never a
  stack trace; the API key is scrubbed and the message is flattened to one line
  so a hostile endpoint cannot leak the key or forge a verdict line.
- **Ran / Skipped** — every bundled skill and why a skipped one is dormant. A
  skill needing a vendor key beyond the LLM provider is named with the secret
  reference to supply and its manifest gate; some (a composite gate such as
  SMTP) need extra config, so the section points at
  [Activation gates](activation-gates.md). A bundled package that produces no
  registration at all is an error, not a skip. Skipped skills never abort the run.
- **Egress** — every host contacted during the run, redirect targets included:
  the command follows redirects manually and permits network only to the LLM
  endpoint, so a request (or redirect) anywhere else is blocked, recorded, and
  fails the run.
- **Timing** — elapsed wall time, with a notice when a cold run exceeds five
  minutes.

Exit is non-zero when the probe fails, a skill fails to load, egress breaches
the LLM-only allowlist, or the LLM config is missing.

## `elliott skills`

```
elliott skills install [--refresh]
elliott skills lock    [--refresh]
```

| Invocation | Mode | Behavior |
| :--- | :--- | :--- |
| `skills install` | frozen | Reads `skills.lock.json`, fetches the locked tags, verifies each against its locked digest. No version resolution. |
| `skills install --refresh` | refresh | Re-resolves unpinned entries to semver-max, fetches, digests, rewrites the lock. |
| `skills lock` | refresh | Identical to `install --refresh`. |

With no `install:` block in the runtime config, the command prints
`no install: block configured; nothing to do` and exits 0.

Any action other than `install` or `lock` raises
`usage: elliott skills install|lock [--refresh]`.

Under frozen mode a required-skill failure is fatal. Digest mismatch, an
unreachable registry, or a validation failure fails the command rather than
degrading.

## Evolution control plane

Any invocation not claimed above is forwarded to the evolution CLI.

| Variable | Required | Meaning |
| :--- | :--- | :--- |
| `ELLIOTT_CONTROL_PLANE_URL` | yes | HTTP endpoint of the control plane |
| `ELLIOTT_CONTROL_PLANE_TOKEN` | no | sent as `Authorization: Bearer <token>` |

Without `ELLIOTT_CONTROL_PLANE_URL` the CLI exits non-zero with:

```
Evolution commands require ELLIOTT_CONTROL_PLANE_URL;
usage: elliott doctor | new skill|tool|agent <name> [directory]
```

## Repository scripts

`bun run <script>` entries in this repository. These are not subcommands of the
`elliott` binary.

| Script | Runs |
| :--- | :--- |
| `start` | `bun src/runtime/main.ts` |
| `dev` | the same, with `ELLIOTT_ENV=dev` |
| `typecheck` | `tsc --noEmit` |
| `lint` / `lint:fix` / `lint:strict` | eslint; strict fails on any warning |
| `format` / `format:check` | dprint |
| `test` | `bun test` |
| `test:coverage` | suite plus the aggregate coverage gate |
| `ratchet:check` | coverage floors were not lowered against the merge base |
| `unicode:check` | bidi and zero-width characters in tracked text |
| `workflows:check` | workflow security gate |
| `footprint:check` | prompt footprint against `config/footprint-budgets.json` |
| `hot-core:build` / `hot-core:check` | native addon build and gates |
| `darwin:build` / `darwin:check` / `darwin:smoke` | darwin evolver gates |
| `evolution:acceptance` | evolution production-acceptance audit |
| `check` | typecheck, lint, format:check, test, darwin:check, footprint:check, hot-core:check, unicode:check, workflows:check |
