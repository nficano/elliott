# Agents: framework vs agent repos

Status: shipped (loader seam, agent-repo deployable, personal-skill
migration). Only `spec.components` enforcement remains open.

## Intent

Elliott is a **framework**. Agents are created on top of it and live in
**separate repos**. The framework ships the built-in skills — generic
capabilities any agent might want (fetch, files, terminal, ssh, scheduler,
mcp-client, evaluators, deep-trace). An agent repo holds everything
specific to that agent: its definition (persona, model profile, component
opt-ins), its configuration, and its **custom skills**. The agent repo is
the deployable — it depends on the elliott framework and boots it.

An agent repo ("pod") keeps one directory per agent:

```
my-agents/
  package.json               # depends on elliott (link: locally;
                             # pinned git dep for CI/deploy)
  agents/
    assistant/
      agent.yaml             # agent definition (persona, components, mcp)
      skills/
        <name>/
          manifest.yaml      # same package format as framework skills
          TOOL.md | EXTENSION.md | …
          src/index.ts       # register(context) → { tools, routes, … }
```

Agent skills use the exact same package contract as built-ins — one
`register()` seam, one component manifest, one loader. Bun runs TypeScript
straight from node_modules, so agent skills import framework types from the
`elliott/skills` and `elliott/runtime` exports with no build step.

Both catalogs may use category directories. Discovery recursively finds
directories containing `manifest.yaml` and treats each as a package; it does
not derive component identity from the directory path.

## The seam (shipped)

- `loadAgentSkillPackages(root, agent)` in `src/catalog/bundled.ts` scans
  `<root>/agents/<agent>/skills/` with the same package loader as `skills/`.
  Missing directory ⇒ empty list. `root` here is *whichever checkout holds
  the agent* — the elliott repo keeps none; a pod repo passes its own root.
- `RuntimeApp.start` composes framework + agent packages; duplicate tool
  names fail fast in `collectTools`.
- `RuntimeApp` splits **frameworkRoot** (where the built-in `skills/` load
  from: the installed `elliott` package) from **agentRoot** (where
  `config/elliott.yaml`, `agents/<name>/agent.yaml`, the persona, the
  secrets mapping, and the agent's `skills/` come from: the pod checkout).
  The pod owns `src/main.ts`, the Dockerfile, and the deploy job; the
  elliott repo only tests.
- Personal skills live outside the framework: generic reusable skills are
  installed from the skills registry (see `skills-registry.md`), and
  agent-specific ones sit in the pod's `agents/<name>/skills/`.

## Agent-local skill settings

Agent-local skills own their config schemas. The runtime passes the raw
resolved `skills:` config subtree through on `settings.skillConfig`;
secrets arrive as env vars rendered by the pod's deploy. Framework and
registry skills keep their typed settings loaders.

## Open — enforce `spec.components`

The agent yaml should become the authority for which *built-ins* activate:
filter framework packages against `spec.components` instead of loading
whatever is on disk. Gotcha: keep the component list in the agent yaml in
sync before enforcing, or enforcement silently drops live skills.
Agent-local skills need no listing: living in the agent's repo IS the
opt-in.

## Rules going forward

- New generic capability → the skills registry (or elliott `skills/` if it
  belongs in every install).
- New agent-specific integration → the pod's `agents/<name>/skills/`.
- An agent skill may do anything a bundled skill can (tools, routes,
  services, gateways) and reads the same `SkillContext`.
