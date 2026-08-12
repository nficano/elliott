# Quality gates

The gates are non-negotiable and they only ratchet. If a gate fails, fix
the code; if a gate genuinely needs changing, ask the operator — gate
files are protected from agent edits by a PreToolUse hook.

## What runs where

| Stage    | Gates                                                                 |
| :------- | :--------------------------------------------------------------------- |
| pre-push | ratchet-guard, `lint:strict` (zero warnings), coverage gate            |
| CI       | typecheck, format check, unicode safety, workflow security, full suite in a 3-posture matrix, footprint budgets, hot-core, darwin |

`bun run check` reproduces the CI set locally.

## The rules

- **Never bypass hooks.** `--no-verify` and `core.hooksPath` overrides
  are blocked. If a gate fails, report the failure — do not route around
  it.
- **Coverage floors only move up.** `scripts/ratchet-guard.ts` rejects
  any change that lowers a floor in `scripts/coverage-gate.ts`.
- **Zero lint warnings.** The config includes custom rules for Effect
  idioms and information-flow safety, plus: named types only in
  `types.ts` modules, no `process.env` outside the config boundary,
  named time constants with units, no magic numbers.
- **Formatting is dprint** (TypeScript + JSON; Markdown is not
  formatted).
- **Unicode safety** (`bun run unicode:check`) scans for unsafe
  characters; **workflow security** (`bun run workflows:check`) gates
  `.github/workflows` changes.

## Protected files

These are operator-only; agent edits are blocked:

- `eslint.config.js`, `dprint.json`
- `scripts/coverage-gate.ts` floors
- `.githooks/`, `.github/workflows/`, `.claude/`

## Why this shape

The gates encode the same doctrine as the runtime: fail closed, ratchet
forward, and keep enforcement outside the thing being enforced. The
reasoning lives in
[Design decisions](../explanation/design-decisions.md).
