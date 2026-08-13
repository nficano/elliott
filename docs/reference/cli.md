# CLI

The `elliott` binary is declared as `bin.elliott` in `package.json`, resolving
to [`src/cli.ts`](../../src/cli.ts). Invoke it as `bunx elliott …` from a
consumer repository, or `bun src/cli.ts …` inside this one.

Argument handling is ordered: scaffolding claims the invocation first, then
`skills`, then everything else falls through to the evolution control plane.

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
usage: elliott new skill|tool|agent <name> [directory]
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
