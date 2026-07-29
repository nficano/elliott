# Agents: framework vs agent repos

Status: phase 1 in progress · 2026-07-28

## Intent

Elliott is a **framework**. Agents are created on top of it and live in
**separate repos**. The framework ships the built-in skills — generic
capabilities any agent might want (search, fetch, files, terminal, ssh,
browser, gateways, scheduler, mcp-client). An agent repo holds everything
specific to that agent: its definition (persona, model profile, component
opt-ins), its configuration, and its **custom skills**. The agent repo is
the deployable — it depends on the elliott framework and boots it.

Canonical agent repo: `~/code/tide-pods` (github.com/nficano/tide-pods),
one directory per agent:

```
tide-pods/
  package.json               # depends on elliott (link:../elliott locally;
                             # pinned git dep for CI/deploy)
  agents/
    oslo/
      agent.yaml             # agent definition (persona, components, mcp)
      skills/
        <name>/
          manifest.yaml      # same package format as framework skills
          TOOL.md | EXTENSION.md | …
          src/index.ts       # register(context) → { tools, routes, … }
```

Agent skills use the exact same package contract as built-ins — one
`register()` seam, one component manifest, one loader. Bun runs TypeScript
straight from node_modules, so agent skills import framework types as
`elliott/src/runtime/skills/types` with no build step.

Both catalogs may use category directories. Discovery recursively finds
directories containing `manifest.yaml` and treats each as a package; it does
not derive component identity from the directory path.

## Phase 1 — loader seam + first custom skill (this change)

- `loadAgentSkillPackages(root, agent)` in `src/catalog/bundled.ts` scans
  `<root>/agents/<agent>/skills/` with the same package loader as `skills/`.
  Missing directory ⇒ empty list. `root` here is *whichever checkout holds
  the agent* — the elliott repo keeps none, so in today's deploy this is a
  no-op; the tide-pods repo passes its own root.
- `RuntimeApp.start` composes framework + agent packages; duplicate tool
  names fail fast in `collectTools`.
- First custom skill lives in tide-pods:
  `agents/oslo/skills/homelab-directory` (static directory of homelab
  services). Its smoke test in that repo drives elliott's real loader
  through the package dependency — proving the consumption path.

## Phase 2 — make the agent repo the deployable (planned, needs sign-off)

The real inversion. Requires splitting `RuntimeApp`'s single `root` into:

- **frameworkRoot** — where `skills/` (built-ins) load from: the installed
  `elliott` package.
- **agentRoot** — where `config/elliott.yaml` (rename: `config/agent.yaml`),
  `agents/<name>/agent.yaml`, the persona, secrets mapping, and the agent's
  `skills/` come from: the tide-pods checkout.

Then tide-pods grows `src/main.ts` (`import { ElliottRuntime } from
"elliott/..."`), its own Dockerfile, and the CI deploy job moves there;
the elliott repo's deploy retires. Secrets flow is unchanged (Vault AppRole
renders the same `.env`).

## Phase 3 — migrate the personal skills out of the framework (planned)

Move from `skills/` to `tide-pods/agents/oslo/skills/`: pihole,
traefik, news-brief, pakman-latest-episode, youtube-dvr, subscription-usage
(telemetry-map debatable — observability may stay framework). Their settings
loaders (`settings-skills.ts`, pihole/traefik in `settings-tools.ts`) move
to an agent-settings module in the same pass, and their `BUNDLED_CATALOG`
entries become an agent manifest.

## Phase 4 — enforce `spec.components` (planned)

The agent yaml becomes the authority for which *built-ins* activate: filter
framework packages against `spec.components` instead of loading whatever is
on disk. Gotcha: the current list in `agents/elliott.yaml` is stale — sync
it first or enforcement silently drops live skills. Agent-local skills need
no listing: living in the agent's repo IS the opt-in.

## Rules going forward

- New generic capability → elliott `skills/` + `BUNDLED_CATALOG`.
- New personal/homelab integration → `tide-pods/agents/oslo/skills/`.
- An agent skill may do anything a bundled skill can (tools, routes,
  services, gateways) and reads the same `SkillContext`.
