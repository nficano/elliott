# Framework skills vs. agent skills

elliott is a framework. An agent is a separate repository that installs it. The
boundary between them is the question this page answers: when you build a new
capability, which tree does it belong in?

## The split

The framework ships skills any agent might want: fetch, files, terminal, ssh,
scheduler, mcp-client, the evaluators, deep-trace. Generic capability, no
opinion about who is using it.

An agent repository holds everything specific to one agent: its persona, its
model profile, its component opt-ins, its configuration, and its own skills. It
depends on elliott and boots it. It is the deployable.

```
my-agents/
  package.json               # depends on elliott
  agents/
    assistant/
      agent.yaml             # persona, components, mcp
      skills/
        <name>/
          manifest.yaml      # same package format as framework skills
          SKILL.md
          src/index.ts       # register(context) → { tools, routes, … }
```

## Why separate repositories

Three reasons, in descending order of how much they matter.

An agent that lives in the framework tree cannot be deployed without deploying
the framework. Every persona tweak becomes a framework release. That coupling is
what the split removes: the pod repository pins elliott at a commit and moves at
its own pace.

Second, secrets and configuration have a natural home. `config/secrets.yaml`,
the agent's persona, the deploy job, and the Dockerfile all belong to whoever
operates the agent. Keeping them out of the framework keeps the framework
publishable.

Third, a framework tree with one agent's skills in it teaches the wrong lesson.
The next person adds theirs, and `skills/` becomes a junk drawer where the
question "should this ship to everyone?" stops being asked.

## One contract, three sources

Agent skills use the identical package contract as built-ins: one `register()`
seam, one component manifest, one loader. Bun runs TypeScript straight out of
`node_modules`, so an agent skill imports framework types from the
`elliott/skills` and `elliott/runtime` exports with no build step.

The loader knows three sources and treats them the same way:

| Source | Where |
| :--- | :--- |
| bundled | `skills/` in the installed elliott package |
| agent-local | `agents/<name>/skills/` in the consumer repository |
| installed | the registry cache, see [The skills registry](skills-registry.md) |

`loadAgentSkillPackages(root, agent)` scans the agent directory with the same
loader as `skills/`. A missing directory yields an empty list. `RuntimeApp.start`
composes framework and agent packages, and duplicate tool names fail fast during
`collectTools` rather than resolving to whichever loaded last.

Both catalogs may use category subdirectories. Discovery finds any directory
holding a `manifest.yaml`. Component identity comes from the manifest, never
from the path, so reorganizing directories does not rename anything.

## frameworkRoot and agentRoot

The runtime splits the two roots explicitly. `frameworkRoot` is where bundled
skills load from, which is the installed package. `agentRoot` is where
`config/elliott.yaml`, `agents/<name>/agent.yaml`, the persona, the secrets
mapping, and the agent's skills come from, which is the pod checkout.

The pod owns `src/main.ts`, the Dockerfile, and the deploy job. This repository
only tests.

## How agent skills read configuration

Agent-local skills own their config schemas. The runtime passes the raw resolved
`skills:` subtree through as `settings.skillConfig`, and secrets arrive as
environment variables rendered by the pod's deploy. Framework and registry
skills keep their typed settings loaders.

Installed skills get a scoped settings view: their own config block plus only
the secret grants their manifest declares, never the global secret bag. Control-plane
secrets, including the governance kill-switch token, appear on no `SkillContext`
at all, because `register()` is arbitrary code that runs before the governor
wraps anything.

## Deciding where a skill goes

New generic capability goes to the registry, or to elliott's `skills/` when it
genuinely belongs in every install. New agent-specific integration goes to the
pod's `agents/<name>/skills/`.

An agent skill may do anything a bundled skill can. Same five binding kinds,
same `SkillContext`, same governance.

## What is still open

`agent.yaml` should become the authority for which built-ins activate, filtering
framework packages against `spec.components` instead of loading whatever is on
disk. It does not yet.

The ordering matters if you pick this up: bring the component list in each
`agent.yaml` up to date before enforcing, or enforcement silently drops live
skills. Agent-local skills need no listing, since living in the agent's
repository is the opt-in.
