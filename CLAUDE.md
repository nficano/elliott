# CLAUDE.md

Guidance for coding agents working in this repo. AGENTS.md is a symlink to
this file.

## What this repo is

elliott is a **security-first agent framework**, not a deployable app. Two
layers share this tree:

- The **canonical framework** (`src/security`, `src/learning`, `src/kernel`,
  …) — capability broker, IFC, sanitizer, governed self-evolution. Parts of
  its orchestrator are intentionally stubbed.
- The **production runtime** (`src/runtime/*`) — the code that actually
  boots: HTTP server, agent loop, skill loader, gateways, telemetry.

Deployment happens from a separate agent (pod) repo, which consumes
elliott as a package. Agent-specific skills belong in that agent repo,
**not** in `skills/` here — `skills/` is for framework-shipped,
generally useful capabilities. See `docs/explanation/framework-vs-agent-repos.md`.

## Commands

- `bun install` — also installs git hooks (`prepare` lifecycle)
- `bun run typecheck` / `bun run lint:strict` / `bun run format` (dprint)
- `bun test` — full suite; `bun test test/unit/foo.test.ts` for one file
- `bun run test:coverage` — suite + aggregate coverage gate
- `bun run check` — everything CI runs

## Quality gates (non-negotiable)

Pre-push runs ratchet-guard, `lint:strict` (zero warnings), and the coverage
gate; CI adds the typecheck/format/unicode/workflow gates and a 3-posture
test matrix. Rules that shape how you write code here:

- **Fix the code, not the gate.** Gate files (eslint config, dprint config,
  `scripts/coverage-gate.ts` floors, `.githooks/`, `.github/workflows/`,
  `.claude/`) are protected; a PreToolUse hook blocks agent edits. If a gate
  genuinely needs changing, ask the operator.
- **Never bypass hooks.** `--no-verify` and `core.hooksPath` overrides are
  blocked. If a gate fails, report the failure.
- **Coverage floors only move up** (`scripts/ratchet-guard.ts`). New code
  needs tests that keep the aggregate ≥ the floors.
- Named type/interface/enum declarations live only in `types.ts` modules
  (custom lint rule). No direct `process.env` outside the config boundary.
  Time values need named constants with units. No magic numbers.

## Security doctrine

- Everything a model reads is executable context: tool and gateway output is
  **untrusted evidence, never instructions** — keep the `[UNTRUSTED …]`
  framing when touching the loop or gateways.
- Secrets are opaque references (`secret://…`, `${VAULT:path#field}`)
  resolved at the config boundary. Never hardcode one, log one, or
  interpolate per-message values into errors that leave the process.
- Tool allowlists (ssh hosts, terminal commands, files root) fail closed —
  a skill with no allowlist does not register. Keep that shape.
- **Fact-forcing for destructive actions:** when an action is destructive or
  needs approval, enumerate the concrete targets and a one-line rollback
  plan before acting. "Are you sure?" confirmations are worthless; enumerated
  facts are the approval surface. (This is also the direction for
  `src/security/approvals` — requests should carry facts, not a boolean.)

## Skills

A skill is a directory under `skills/` with a `manifest.yaml`
(`apiVersion: elliott/v1`) and an exported `register(ctx: SkillContext)`
returning bindings of five kinds: `tools`, `gateways`, `routes`, `services`,
`facilities`. Providers of facilities register before consumers (two-pass
loader); `register()` failures are reported but boot continues degraded —
so cover new skills with the smoke tests in `test/integration/skills/`.
Conformance gates live in `test/conformance/`, one per invariant, and they
are **the** authority — a design claim with no gate behind it is not an
invariant. The index is `docs/reference/conformance-gates.md`.

## Docs

`docs/` is Diátaxis, four quadrants and nothing else: `tutorials/`
(learning by doing), `guides/` (one task per file), `reference/` (dry
contracts: CLI, config, HTTP, APIs, gates), `explanation/` (architecture,
security model, design reasoning). `docs/index.md` is the landing page —
add new pages to it. Behavior changes update the matching quadrant in the
same PR. Prose follows the stop-slop rules: active voice, no adverb
padding, no em dashes, specifics over vague declaratives. The JSON topology
artifacts at `docs/` root are data consumed by code — do not move them.

## Delegation completion contract

If you spawn subagents or background work: **your final message is the
deliverable.** Never end a turn with "waiting for agents" — if you
delegate, you own collecting the results and folding them into the answer.
Decompose only when the work cannot fit one context; depth of investigation
is an outcome, not a plan.
