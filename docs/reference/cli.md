# CLI reference

The `elliott` binary is declared in `package.json` (`bin.elliott` →
`src/cli.ts`). Invoke it with `bunx elliott …` from a consumer repository
or `bun src/cli.ts …` inside this one.

## Scaffolding

```
elliott new skill <name> [directory]
elliott new tool  <name> [directory]
elliott new agent <name> [directory]
```

- `<name>` — lowercase letters, digits, and hyphens; max 64 characters.
- `[directory]` — parent directory; defaults to `.`.
- Prints the created directory on success.
- `skill` / `tool` scaffold a component package (manifest overlay, kind
  document, conformance test). `agent` scaffolds a consumer agent
  repository.

## Skills installation

```
elliott skills install [--refresh]
elliott skills lock    [--refresh]
```

- `install` — materialize the skills declared in the runtime config's
  `install:` block, verifying content digests against the lock.
- `lock` — resolve and write the digest lock file.
- `--refresh` — re-resolve versions instead of honoring the existing lock.

See [Install skills from the registry](../guides/install-registry-skills.md).

## Evolution control plane

Any other invocation is forwarded to the evolution CLI
(`src/learning/evolution/cli/`), which accepts:

```
elliott evolve inspect <target>
elliott evolve dataset build <target> [...]
elliott evolve run | status | pause | resume | cancel | compare | propose [...]
elliott proposal review | approve | reject <proposal-id>
elliott release promote | rollback <id>
```

Each operation maps to a control-plane capability check (e.g.
`evolution.inspect` → `evolution.target.read`, `release.promote` →
`release.promote`); the CLI has no direct deployment shortcut — promotion
and rollback run through the Proposal workflow's transactional activation.
It requires:

| Environment variable          | Required | Meaning                              |
| :---------------------------- | :------- | :----------------------------------- |
| `ELLIOTT_CONTROL_PLANE_URL`   | yes      | HTTP endpoint of the control plane   |
| `ELLIOTT_CONTROL_PLANE_TOKEN` | no       | sent as `Authorization: Bearer <t>`  |

Without `ELLIOTT_CONTROL_PLANE_URL` the CLI exits with usage help.

## Repository scripts

These are `bun run <script>` entries in this repository, not subcommands
of the `elliott` binary:

| Script                | What it runs                                          |
| :-------------------- | :---------------------------------------------------- |
| `start`               | `bun src/runtime/main.ts` — the production runtime    |
| `dev`                 | same, with `ELLIOTT_ENV=dev`                          |
| `check`               | everything CI runs (typecheck, lint, format, tests, darwin, footprint, hot-core, unicode, workflows) |
| `typecheck`           | `tsc --noEmit`                                        |
| `lint` / `lint:strict`| eslint (strict: zero warnings)                        |
| `format` / `format:check` | dprint                                            |
| `test`                | `bun test` — full suite                               |
| `test:coverage`       | suite + aggregate coverage gate                       |
| `ratchet:check`       | coverage-floor ratchet guard                          |
| `unicode:check`       | unicode safety scan                                   |
| `workflows:check`     | workflow security gate                                |
| `footprint:check`     | prompt/footprint budget gate                          |
| `hot-core:build` / `hot-core:check` | native hot-core build and gates         |
| `darwin:check` / `darwin:build` / `darwin:smoke` | darwin evolver gates     |
| `evolution:acceptance`| evolution production-acceptance audit                 |
