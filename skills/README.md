# Elliott bundled components

This directory is the first-party component catalog shipped by Elliott.
Packages may live directly under `skills/` or in a category directory. Every
directory containing `manifest.yaml` is one complete Elliott component package
following the standard layout (TDD §7.18b): the manifest declares its authority
and runtime posture, the kind-specific Markdown document describes its
model-visible behavior, and `src/` carries the executable implementation where
one exists.

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

Category directories remove repeated package-name prefixes without changing
manifest identities or component references:

- `evaluator/{agent-benchmarks,darwinian,dspy}`
- `gateway/{bluebubbles,email,gmail,home-assistant,slack,webhook}`
- `search/{brave,duckduckgo}`
- `web/{firecrawl,parallel}`

Standalone bundled components remain directly under `skills/`:

- Agent instruction sources: `code-review`, `research`, `debugging`
- Browser and retrieval: `browser`, `fetch`
- Connectivity: `mcp-client`, `cloudflared`
- Local execution: `files`, `terminal`, `ssh`
- Automation: `scheduler`

Executable entries ship a registration module. Zero-authority prompt sources
need no executable module. Several executable entries stay dormant until the
operator provisions a secret or flips an enable flag (e.g. `terminal` and
`ssh` require an explicit allowlist; `gateway-email` requires SMTP
credentials and a recipient allowlist). See
[`docs/blockers.md`](../docs/blockers.md) for the current activation state of
each.
