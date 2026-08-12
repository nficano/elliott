# Testing

## Suites

| Directory           | What it holds                                                |
| :------------------ | :----------------------------------------------------------- |
| `test/unit/`        | unit tests, colocated by subsystem                           |
| `test/integration/` | cross-module tests; `test/integration/skills/` is the skill smoke suite |
| `test/conformance/` | one gate per TDD invariant (G1–G26) — these encode the design; do not weaken them |
| `test/fuzz/`        | fuzzing (e.g. the native hot-core)                           |

```bash
bun test                          # everything
bun test test/unit/foo.test.ts    # one file
bun run test:coverage             # suite + aggregate coverage gate
```

## Coverage is a ratchet

`scripts/coverage-gate.ts` enforces aggregate floors and
`scripts/ratchet-guard.ts` ensures the floors only move **up**. New code
needs tests that keep the aggregate at or above the floors — shipping
untested code fails the pre-push hook, and lowering a floor is a
protected-file change only the operator can make.

## Skills need smoke tests

Skill registration failures degrade silently by design (boot continues),
so every skill must have a Tier-0/Tier-1 smoke test in
`test/integration/skills/` proving it registers and its logic works
offline. The tiers, fixtures (`makeSmokeContext`, `loadOneSkill`,
`stubFetch` cassettes), and rationale are in
[skill-e2e-smoke-strategy.md](skill-e2e-smoke-strategy.md).

## CI posture matrix

CI runs the test suite under all three security postures (`standard`,
`hardened`, `regulated`). The `standard` posture executes the same code
paths vacuously, so a test that passes only in one posture usually means
enforcement leaked into semantics — treat that as a bug in the change,
not the matrix.

## Writing tests here

- Deterministic and offline: network is stubbed (cassettes), time is
  explicit.
- Test the contract, not the implementation; conformance gates are the
  model for tone.
- A new invariant in the TDD gets a new `test/conformance/g<N>-*.test.ts`.
