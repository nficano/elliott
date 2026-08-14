# elliott documentation

elliott is a security-first TypeScript framework for composing personal AI
agents from one primitive: the Component.

These docs are organized by what you are trying to do, following
[Diátaxis](https://diataxis.fr). Four quadrants, and each page sits in exactly
one.

| You are… | Go to |
| :--- | :--- |
| learning by doing | [Tutorials](#tutorials) |
| working toward a goal | [How-to guides](#how-to-guides) |
| looking up an exact contract | [Reference](#reference) |
| trying to understand the design | [Explanation](#explanation) |

## Tutorials

Start here if elliott is new to you. Both are hand-held, take one path, and end
with something running.

- [Run your first agent](tutorials/run-your-first-agent.md) — clone to a booted
  runtime, and why the skill and tool counts differ
- [Build your first skill](tutorials/build-your-first-skill.md) — four files, a
  smoke test, and a tool the model can call

## How-to guides

Recipes for people who already know the basics.

- [Check your setup end-to-end](guides/check-your-setup.md)
- [Create an agent repository](guides/create-an-agent-repo.md)
- [Set up a development environment](guides/set-up-a-development-environment.md)
- [Install skills from the registry](guides/install-registry-skills.md)
- [Enable the terminal and SSH tools](guides/enable-terminal-and-ssh.md)
- [Consume a facility from another skill](guides/consume-a-facility.md)
- [Write a skill smoke test](guides/write-a-skill-smoke-test.md)
- [Operate the governance kill switch](guides/operate-the-governance-kill-switch.md)

## Reference

Dry and complete. Structured for lookup rather than reading.

- [Configuration](reference/configuration.md) — both config files, every key,
  every environment variable
- [CLI](reference/cli.md) — the `elliott` binary and the repository scripts
- [HTTP API](reference/http-api.md) — routes, health shape, control planes
- [Activation gates](reference/activation-gates.md) — what each bundled
  component waits on before it registers
- [Quality gates](reference/quality-gates.md) — what runs pre-push and in CI
- [Conformance gates](reference/conformance-gates.md) — G1 through G27, one file
  each
- [Known issues](reference/known-issues.md) — limits the framework knows about
  and has decided not to close yet, with what closing each one takes
- [`register()` and `SkillContext`](reference/api/skill-context.md)
- [`manifest.yaml`](reference/api/manifest.md)
- [Package exports](reference/api/package-exports.md)

## Explanation

Background and design reasoning. Read away from the keyboard.

- [Architecture](explanation/architecture.md) — the two layers, and which one
  you are standing in
- [The security model](explanation/security-model.md) — the premise everything
  else follows from
- [Governance](explanation/governance.md) — the tool chokepoint, and why it is
  default-allow
- [Framework skills vs. agent skills](explanation/framework-vs-agent-repos.md)
- [Facilities](explanation/facilities.md) — how skills provision each other
- [The skills registry](explanation/skills-registry.md)
- [Testing strategy](explanation/testing-strategy.md)

## Contributing

[CONTRIBUTING.md](../CONTRIBUTING.md) is the front door. The development task
lives at
[Set up a development environment](guides/set-up-a-development-environment.md),
the gates at [Quality gates](reference/quality-gates.md), and the reasoning at
[Testing strategy](explanation/testing-strategy.md).

## Machine-readable artifacts

The JSON files at the root of `docs/` (`elliott-topology*.json`,
`topology.spine.json`) are data consumed by code: `scripts/gen-topology.mjs`,
the deep-trace skill, and two unit tests. They are not prose and they stay at
these exact paths. Do not move them when reorganizing docs.
