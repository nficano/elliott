# Contributing to Elliott

Thanks for your interest. Elliott is a security-first agent framework;
contributions are expected to preserve its invariants, and the repository
enforces most of them mechanically.

## Quick start

```bash
git clone git@github.com:nficano/elliott.git
cd elliott
bun install        # also installs the git hooks — required
bun run check      # everything CI runs
```

## Before you open a PR

- Read [docs/contributing/setup.md](docs/contributing/setup.md) and
  [docs/contributing/quality-gates.md](docs/contributing/quality-gates.md).
  The gates (zero lint warnings, coverage ratchet, conformance suite) are
  non-negotiable and cannot be bypassed.
- New code needs tests. New skills need smoke tests in
  `test/integration/skills/`
  ([why](docs/contributing/testing.md)).
- Behavior changes need doc changes in the same PR. Docs follow
  [Diátaxis](https://diataxis.fr) under [docs/](docs/index.md) — put
  task recipes in `docs/guides/`, contracts in `docs/reference/`,
  rationale in `docs/explanation/`.
- Agent-specific skills belong in your agent repository, not in
  `skills/` here
  ([explanation](docs/explanation/agent-skills.md)).

## Security

Do not report vulnerabilities in public issues — see
[SECURITY.md](SECURITY.md).

## Design authority

The [Technical Design Document](docs/explanation/elliott-tdd.md) is the
authority for every invariant; each maps to a conformance gate under
`test/conformance/`. Changes that weaken an invariant will not be merged.
