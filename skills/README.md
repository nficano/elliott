# Elliott bundled components

This directory is the first-party component catalog shipped by Elliott. Each
directory is a complete Elliott component package following the standard
layout (TDD §16b): `component.yaml` declares its authority and runtime
posture, the kind-specific Markdown document describes its model-visible
behavior, and `src/` carries the executable implementation where one exists.

The runtime discovers these packages directly. A package that exports an
executable declares it in `component.yaml`:

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

Bundled components:

- Search and web: `search-duckduckgo`, `search-brave`, `web-firecrawl`,
  `web-parallel`, `browser`, `fetch`
- Connectivity: `mcp-client`, `gateway-slack`, `gateway-bluebubbles`,
  `gateway-email`, `gateway-gmail`, `gateway-home-assistant`,
  `gateway-webhook`, `cloudflared`
- Local execution: `files`, `terminal`, `ssh`
- Automation: `scheduler`

Every entry ships an executable module. Several stay dormant until the
operator provisions a secret or flips an enable flag (e.g. `terminal` and
`ssh` require an explicit allowlist; `gateway-email` requires SMTP
credentials and a recipient allowlist). See `BLOCKERS.md` for the current
activation state of each.
