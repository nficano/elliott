# Changelog

All notable changes to Elliott are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Tagging begins with
`v0.1.0`; each version section below doubles as that release's GitHub release
notes.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-08-14

### Added

- Diátaxis documentation structure under `docs/` (getting-started,
  tutorials, guides, reference, explanation, contributing) with a
  [landing page](docs/index.md); root `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, and MIT `LICENSE`.
- Skills registry: public `nficano/skills` registry with an installer
  (`elliott skills install|lock`), frozen/refresh modes, and a digest
  lock.
- Guardrail layer: harness hooks, CI security gates, and runtime loop
  detection.
- Skill facilities: fifth `register()` binding kind; `ingress.webhook`,
  `dns.local`, and `proxy.route` facilities.
- Agent governance: `ToolGovernor` policy/identity/audit chokepoint on
  every tool call, durable hash-chained audit log, bearer-guarded kill
  switch.

### Changed

- Prose docs moved into Diátaxis quadrants; machine-readable topology
  JSON artifacts intentionally remain at `docs/` root (consumed by code).
- Consolidated the chat gateways (`gateway-slack`, `gateway-email`,
  `gateway-gmail`, `gateway-bluebubbles`, `gateway-webhook`), the search
  and web-extraction tools (`search-brave`, `search-duckduckgo`,
  `web-firecrawl`, `web-parallel`), `traefik`, and `webhook-provisioner`
  from the `nficano/skills` registry into the framework's built-in
  catalog. `gateway-home-assistant` and `pihole` stay in the registry.
  None of the moved skills are enabled by default.
- README's Quick start and the
  [Run your first agent](docs/tutorials/run-your-first-agent.md) tutorial
  now set `ELLIOTT_LLM_PROVIDER` instead of `ELLIOTT_LLM_BASE_URL`. The
  shipped `config/elliott.yaml` reads `llm.provider`; its `llm.base_url` line
  is commented out by default, so `ELLIOTT_LLM_BASE_URL` alone did nothing
  against a fresh clone. Every other doc already used `ELLIOTT_LLM_PROVIDER`;
  this closes the one place that still didn't.

### Breaking changes

For `workspace-agents` and any other consumer pinning an older commit: the
eleven skills named in the `Changed` entry above stopped resolving from
the `nficano/skills` registry and started shipping in elliott's own bundled
catalog. A consumer repo (this includes `workspace-agents`, currently pinned
to `elliott@0d7fc31`) that still lists any of them under its
`config/elliott.yaml` `install.skills` — or carries them in a committed
`skills.lock.json` — will get one of two failures on upgrade, depending on
which binding kind the skill registers:

- **Tool-kind skills fail the boot outright**: `search-brave`,
  `search-duckduckgo`, `web-firecrawl`, `web-parallel`, `gateway-email`, and
  `traefik` all register a `tools` binding. `collectTools`
  ([src/runtime/skills/loader.ts:84](src/runtime/skills/loader.ts#L84)) throws
  `Tool <name> is exported by both <installed> and <bundled>` the instant a
  registry-installed copy and the new bundled copy share a name. This is a
  loud, immediate crash — annoying, but safe.
- **Gateway-kind skills double-register silently**: `gateway-slack`,
  `gateway-gmail`, `gateway-bluebubbles`, and `gateway-webhook` register a
  `gateways` binding, and `collectGateways`
  ([src/runtime/skills/loader.ts:104](src/runtime/skills/loader.ts#L104)) has
  no duplicate-name check — it is a plain `flatMap`. Both copies register,
  and `#startBindings` starts both
  ([src/runtime/app.ts:446](src/runtime/app.ts#L446)): two live connections
  to the same external service on the same credential (for example, two
  Slack Socket Mode clients on one bot token), which reads as duplicate
  messages or replies rather than as a boot failure. `webhook-provisioner`
  (a `facilities` binding) has the same unchecked-`flatMap` exposure via
  `collectFacilities`.

**Fix**: remove all eleven names from `install.skills` and from
`skills.lock.json`, then enable elliott's built-in equivalents through
`config/elliott.yaml`'s own `tools` / `gateways` / `channels` blocks (all off
by default — see
[Activation gates](docs/reference/activation-gates.md)). Phase 8 of this
consolidation run carries out this migration for `workspace-agents`
specifically.

### Rollback

```bash
# Undo the tag if it was cut in error:
git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0

# Pin a consumer back to the commit before this release:
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git#4904d38326f1b59aac362540ac92878b85ca0763"
```

[Unreleased]: https://github.com/nficano/elliott/compare/v0.1.0...main
[0.1.0]: https://github.com/nficano/elliott/releases/tag/v0.1.0
