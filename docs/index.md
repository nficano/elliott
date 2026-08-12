# Elliott documentation

Elliott is a security-first TypeScript framework for composing personal AI
agents from one universal primitive — the **Component**. This documentation
is organized by what you are trying to do ([Diátaxis](https://diataxis.fr)),
not by topic. Pick the column that matches your intent:

| I want to…                                | Go to                                    |
| :---------------------------------------- | :--------------------------------------- |
| install it and see it run                 | [Getting started](getting-started/installation.md) |
| learn by building something               | [Tutorials](tutorials/your-first-skill.md) |
| accomplish a specific task                | [How-to guides](#how-to-guides)          |
| look up an exact API, command, or config key | [Reference](#reference)               |
| understand why it is designed this way    | [Explanation](#explanation)              |
| work on Elliott itself                    | [Contributing](../CONTRIBUTING.md)       |

## Who this is for

- **Agent authors** — you maintain your own agent repository that installs
  Elliott as a dependency and composes skills. Start at
  [Getting started](getting-started/installation.md), then
  [Create an agent repository](guides/create-an-agent-repo.md).
- **Skill authors** — you want to teach an agent a new capability. Do the
  [first-skill tutorial](tutorials/your-first-skill.md), then use the
  [reference](reference/api/skill-context.md) for the exact seam.
- **Framework contributors** — you are changing Elliott itself. Read the
  [architecture](explanation/architecture.md) and the
  [contributor docs](contributing/setup.md); the
  [Technical Design Document](explanation/elliott-tdd.md) is the authority
  for every invariant.

## Getting started

- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)

## Tutorials

Learning-oriented, hand-held paths for newcomers.

- [Your first skill](tutorials/your-first-skill.md)

## How-to guides

Task-oriented recipes; each assumes you know the basics.

- [Create an agent repository](guides/create-an-agent-repo.md)
- [Install skills from the registry](guides/install-registry-skills.md)
- [Enable the terminal and SSH tools](guides/enable-terminal-and-ssh.md)
- [Consume a facility from another skill](guides/consume-a-facility.md)

## Reference

Dry, complete, and meant for lookup.

- [CLI](reference/cli.md)
- [Configuration](reference/configuration.md)
- [API: package exports](reference/api/package-exports.md)
- [API: the skill `register()` seam](reference/api/skill-context.md)
- [API: `manifest.yaml`](reference/api/manifest.md)
- [Bundled-component activation status](reference/blockers.md)

## Explanation

Background, design decisions, and architecture.

- [Architecture](explanation/architecture.md) — the two layers and how a
  request flows through them
- [Design decisions](explanation/design-decisions.md) — the security
  doctrine and why the gates are shaped the way they are
- [Technical Design Document](explanation/elliott-tdd.md) — the
  authoritative design (threat model, component ontology, conformance
  gates G1–G26)
- [Framework skills vs. agent skills](explanation/agent-skills.md)
- [Skill facilities](explanation/skill-facilities.md)
- [Skills registry](explanation/skills-registry.md)
- [Agent governance](explanation/agent-governance.md)
- [deep-trace observability map](explanation/deep-trace-plan.md)
- [Self-evolution (darwin)](explanation/darwin/elliott-self-evolution-adoption-plan.md)

## Contributing

Deeper development docs for working on Elliott itself.

- [Development setup](contributing/setup.md)
- [Testing](contributing/testing.md)
- [Quality gates](contributing/quality-gates.md)
- [Skill e2e/smoke strategy](contributing/skill-e2e-smoke-strategy.md)

## Machine-readable artifacts

The JSON files at the root of `docs/` (`elliott-topology*.json`,
`topology.spine.json`) are **data consumed by code** —
`scripts/gen-topology.mjs`, the deep-trace skill, and tests — not prose
documentation. They stay at fixed paths; do not move them when reorganizing
docs.
