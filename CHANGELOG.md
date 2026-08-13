# Changelog

All notable changes to Elliott are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). There are no
versioned releases yet; consumers pin git commits, so entries accumulate
under **Unreleased** until tagging begins.

## [Unreleased]

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

[Unreleased]: https://github.com/nficano/elliott/commits/main
