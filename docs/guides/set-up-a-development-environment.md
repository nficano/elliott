# How to set up a development environment

For working on elliott itself. If you are building an agent, see
[Create an agent repository](create-an-agent-repo.md) instead.

## Clone and install

```bash
git clone git@github.com:nficano/elliott.git
cd elliott
bun install
```

`bun install` runs the `prepare` lifecycle, which installs the git hooks. Leave
them in place. `--no-verify` and `core.hooksPath` overrides are blocked, so
routing around a failing gate is not an option; fix the code or ask the operator
to change the gate.

## Daily commands

```bash
bun run typecheck                 # tsc --noEmit
bun run lint:strict               # eslint, zero warnings
bun run format                    # dprint fmt
bun test                          # full suite
bun test test/unit/foo.test.ts    # one file
bun run test:coverage             # suite + aggregate coverage gate
bun run check                     # everything CI runs
```

Run `bun run check` before you push anything substantial. The full list of what
each gate asserts is in [Quality gates](../reference/quality-gates.md).

## Decide where your change goes

| Change | Directory |
| :--- | :--- |
| Component model, capability broker, IFC, sanitizer | `src/core`, `src/security` |
| Boot and serving behavior | `src/runtime/` |
| A generally useful skill | `skills/`, with a manifest and a smoke test |
| A skill only your agent needs | your agent repository, not this one |

The distinction between the canonical framework and the production runtime
decides most of these. Read [Architecture](../explanation/architecture.md) if
the answer is not obvious.

## Conventions the linter enforces

- Named type, interface, and enum declarations live only in `types.ts` modules.
- Nothing outside the config boundary reads `process.env`.
- Time values need named constants carrying their unit.
- No magic numbers.
- Secrets stay opaque references. Never hardcode, log, or interpolate one into
  an error that leaves the process.

## Optional native toolchain

The Rust addon under `native/hot-core` backs the linear-DFA scanner. Without a
Rust toolchain the TypeScript scanner takes over and the runtime works fine, but
`bun run hot-core:check` fails. Build it with `bun run hot-core:build`, or skip
that gate locally and let CI run it.

## Before you open a pull request

Behavior changes update the matching documentation quadrant in the same change.
A new invariant in the TDD gets a new gate under `test/conformance/`. New code
needs tests that keep the coverage aggregate at or above the floors, since the
floors only move up.
