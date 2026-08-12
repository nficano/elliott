# Development setup

## Clone and install

```bash
git clone git@github.com:nficano/elliott.git
cd elliott
bun install
```

`bun install` runs the `prepare` lifecycle, which also installs the git
hooks. Do not skip or remove them — the hooks are part of the quality
gates ([quality-gates.md](quality-gates.md)) and bypassing them
(`--no-verify`, `core.hooksPath` overrides) is blocked.

## Daily commands

```bash
bun run typecheck              # tsc --noEmit
bun run lint:strict            # eslint, zero warnings
bun run format                 # dprint fmt (TypeScript + JSON)
bun test                       # full suite
bun test test/unit/foo.test.ts # one file
bun run test:coverage          # suite + aggregate coverage gate
bun run check                  # everything CI runs
```

## Orientation

Read [the architecture](../explanation/architecture.md) first —
especially the distinction between the canonical framework and the
production runtime (`src/runtime/*`), which determines where a change
belongs. The [TDD](../explanation/elliott-tdd.md) is the authority for
invariants; each one has a conformance gate under `test/conformance/`.

Code conventions enforced by lint (fix the code, not the gate):

- Named type/interface/enum declarations live only in `types.ts` modules.
- No direct `process.env` outside the config boundary.
- Time values need named constants with units; no magic numbers.
- Secrets are opaque references; never hardcode, log, or interpolate one.

## Where changes go

- Framework capability, security machinery → `src/*` (canonical layer)
- Boot/serving behavior → `src/runtime/*`
- Generally useful skills → `skills/` (with a manifest and smoke test)
- Agent-specific skills → your agent repository, **not** this one
  ([explanation](../explanation/agent-skills.md))

## Next

- [Testing](testing.md)
- [Quality gates](quality-gates.md)
