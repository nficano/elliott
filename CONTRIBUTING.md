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

- Read
  [Set up a development environment](docs/guides/set-up-a-development-environment.md)
  and [Quality gates](docs/reference/quality-gates.md). The gates (zero lint
  warnings, coverage ratchet, conformance suite) are non-negotiable and cannot
  be bypassed.
- New code needs tests. New skills need smoke tests in
  `test/integration/skills/`
  ([how](docs/guides/write-a-skill-smoke-test.md),
  [why](docs/explanation/testing-strategy.md)).
- Behavior changes need doc changes in the same PR. Docs follow
  [Diátaxis](https://diataxis.fr) under [docs/](docs/index.md) — put
  task recipes in `docs/guides/`, contracts in `docs/reference/`,
  rationale in `docs/explanation/`.
- Agent-specific skills belong in your agent repository, not in
  `skills/` here
  ([explanation](docs/explanation/framework-vs-agent-repos.md)).

## Security

Do not report vulnerabilities in public issues — see
[SECURITY.md](SECURITY.md).

## Design authority

The conformance gates under `test/conformance/` are the authority for every
invariant, one gate per invariant, indexed in
[docs/reference/conformance-gates.md](docs/reference/conformance-gates.md).
Changes that weaken an invariant will not be merged. The reasoning behind the
invariants is in
[docs/explanation/security-model.md](docs/explanation/security-model.md).
