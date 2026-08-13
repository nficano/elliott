# Elliott bundled components

This directory is the first-party component catalog shipped by Elliott.
Packages may live directly under `skills/` or in a category directory. Every
directory containing `manifest.yaml` is one complete Elliott component package
following the standard layout (TDD §7.18b): the manifest declares its authority
and runtime posture, `SKILL.md` (agentskills.io frontmatter plus Markdown)
describes its model-visible behavior, and `src/` carries the executable
implementation where one exists.

The runtime discovers these packages directly. A package that exports an
executable declares it in `manifest.yaml`:

```yaml
spec:
  exports:
    - { ref: tool/brave-search, implementation: src/index.ts }
```

The implementation module exports a single `register(context)` function
(see `src/runtime/skills/types.ts`) returning the tools, gateways, HTTP
routes, and background services the package contributes. A package whose
required settings or secrets are absent registers nothing and stays dormant;
a package with no `exports` at all is a zero-authority descriptor.

Every package directory name equals its `metadata.name` and its `SKILL.md`
frontmatter `name` (an agentskills.io requirement), so each package sits
directly under `skills/` — e.g. `evaluator-dspy`, `evaluator-darwinian`,
`evaluator-agent-benchmarks`.

The framework ships built-ins only. Everything else is installed from the
`nficano/skills` registry (see [`docs/explanation/skills-registry.md`](../docs/explanation/skills-registry.md)).
The built-in set is:

- Retrieval: `fetch`
- Connectivity: `mcp-client`
- Local execution: `files`, `terminal`, `ssh`
- Automation: `scheduler`
- Evolution: `evaluator-dspy`, `evaluator-darwinian`, `evaluator-agent-benchmarks`
- Observability: `deep-trace`, `glitchtip`
- Secrets: `vault`
- Chat gateways: `gateway-slack`, `gateway-gmail`, `gateway-bluebubbles`,
  `gateway-webhook`
- Outbound email: `gateway-email` (SMTP send only — no inbound IMAP path)
- Search and web extraction: `search-brave`, `search-duckduckgo`,
  `web-firecrawl`, `web-parallel`
- Local network: `traefik` (provides the `proxy.route` facility)
- Ingress: `webhook-provisioner` (provides the `ingress.webhook` facility)

`gateway-home-assistant` and `pihole` stay in the registry — everything else
that used to live under `gateway-*`, `search-*`/`web-*`, or `traefik` moved
into this built-in set. None of the moved skills are enabled by default. Most
still gate on the same settings block or secret they needed in the registry;
`search-duckduckgo` needed no secret there (opt-in was just installing it),
so it now carries an explicit `tools.search_duckduckgo.enabled` config gate
it didn't have before — bundling it in core makes it reachable by every
agent unless an operator opts in, which installing-from-registry used to
handle instead. See the table in `docs/reference/blockers.md`.

Executable entries ship a registration module. Several executable entries stay
dormant until the operator provisions a secret or flips an enable flag (e.g.
`terminal` and `ssh` require an explicit allowlist). See
[`docs/reference/blockers.md`](../docs/reference/blockers.md) for the current activation state of
each.
