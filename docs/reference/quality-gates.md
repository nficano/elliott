# Quality gates

## Where each gate runs

| Stage | Gates |
| :--- | :--- |
| pre-push | `ratchet:check`, `lint:strict`, `test:coverage` |
| CI | typecheck, format check, unicode safety, workflow security, the full suite across three postures, footprint budgets, hot-core, darwin, `cargo fmt`, `cargo clippy -D warnings` |

`bun run check` reproduces the CI set locally.

## What each asserts

| Command | Assertion |
| :--- | :--- |
| `bun test` | unit, integration, conformance, and fuzz suites pass |
| `bun run typecheck` | `tsc --noEmit` is clean |
| `bun run lint:strict` | eslint at zero warnings |
| `bun run format:check` | dprint reports no diff |
| `bun run ratchet:check` | no coverage floor in `scripts/coverage-gate.ts` is lower than the merge base |
| `bun run test:coverage` | weighted aggregate is at or above 80% lines and functions |
| `bun run unicode:check` | no bidi or zero-width characters in tracked text |
| `bun run workflows:check` | no `pull_request_target` checking out PR head; no PR jobs on self-hosted runners |
| `bun run footprint:check` | prompt footprint within `config/footprint-budgets.json` |
| `bun run hot-core:check` | cargo tests pass, the addon builds, the native backend is the one in use, the fuzz suite passes |
| `bun run darwin:check` | bun and python tests plus JSON fixture parses under `darwin/` |

## Custom lint rules

Beyond the Effect idiom and information-flow rules:

- Named type, interface, and enum declarations appear only in `types.ts`
  modules.
- Nothing outside the config boundary reads `process.env`.
- Time values use named constants carrying their unit.
- No magic numbers.

dprint formats TypeScript and JSON. Markdown is not formatted.

## The posture matrix

CI runs the suite three times with `ELLIOTT_POSTURE` set to `standard`,
`hardened`, and `regulated`.

No code reads that variable. Posture reaches the kernel as a constructor
argument defaulting to `standard`, so all three jobs currently run identical
paths and the matrix costs three times the minutes while proving one thing.

Wiring the variable through to `AgentKernel` is the open work. Until then, do
not read a green matrix as evidence that a change behaves under `hardened` or
`regulated`.

## Protected files

Agent edits to these are blocked by a PreToolUse hook. Changing one is an
operator decision.

- `eslint.config.js`, `.eslint-rules/`, `dprint.json`, `tsconfig.json`
- `.githooks/`, `.github/workflows/`, `.claude/`
- `config/footprint-budgets.json`
- `scripts/coverage-gate.ts`, `scripts/ratchet-guard.ts`,
  `scripts/check-unicode-safety.ts`, `scripts/check-workflow-security.ts`,
  `scripts/claude-hook-protect-gates.ts`,
  `scripts/claude-hook-block-no-verify.ts`, `scripts/setup-hooks.sh`

## Bypass

`--no-verify` and `core.hooksPath` overrides are blocked. A failing gate is
reported, not routed around.

Coverage floors move up only. Why the gates are shaped this way:
[The security model](../explanation/security-model.md).
