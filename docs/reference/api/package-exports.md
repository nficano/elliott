# Package exports

The `elliott` package exposes these entry points, from the `exports` map in
`package.json`. Import from the subpath, never from a deep file path.

| Import | Module | Contents |
| :--- | :--- | :--- |
| `elliott` | `src/index.ts` | top-level surface including `AgentKernel` |
| `elliott/core` | `src/core/index.ts` | Component, Protocol, Schema, Instance, Registry, Snapshot, Epoch |
| `elliott/security` | `src/security/index.ts` | grants, capability, policy, IFC, sanitizer, secrets, approvals, residency, broker |
| `elliott/model` | `src/model/index.ts` | orthogonal routing, profiles, route tables, resolver, catalog, streaming |
| `elliott/providers` | `src/providers/index.ts` | first-party model providers |
| `elliott/manifest` | `src/manifest/index.ts` | Markdown, YAML, and SKILL.md parsing and hardening; scaffolding |
| `elliott/mcp` | `src/mcp/index.ts` | MCP endpoints, exposure, drivers |
| `elliott/gateway` | `src/gateway/index.ts` | message source and sink pipelines, identity, session |
| `elliott/memory` | `src/memory/index.ts` | session-store, curated, and external-slot providers |
| `elliott/learning` | `src/learning/index.ts` | signals, curator, evaluation, proposals |
| `elliott/audit` | `src/audit/index.ts` | durability classes, shards, cross-linking |
| `elliott/placement` | `src/placement/index.ts` | warm pools, companions, cgroups |
| `elliott/prompt` | `src/prompt/index.ts` | typed prompt architecture |
| `elliott/scheduler` | `src/scheduler/index.ts` | time-based invocation |
| `elliott/observability` | `src/observability/index.ts` | footprint attribution, regression gates |
| `elliott/config` | `src/config/index.ts` | activation, postures |
| `elliott/catalog` | `src/catalog/index.ts` | bundled-package discovery |
| `elliott/agent` | `src/agent/index.ts` | consumer-agent scaffolding |
| `elliott/hotcore` | `src/hotcore/index.ts` | native hot-core bindings |
| `elliott/loop` | `src/loop/index.ts` | the agent run loop |
| `elliott/skills` | `src/runtime/skills/index.ts` | the `register()` seam |
| `elliott/runtime` | `src/runtime/types.ts` | runtime type surface, including `ToolDefinition` |
| `elliott/runtime/app` | `src/runtime/app.ts` | the production application |
| `elliott/package.json` | | package metadata |

`elliott/loop` and the `AgentKernel` on `elliott` belong to the canonical layer.
Nothing under `src/runtime/` imports them.

The `elliott` binary is documented in [the CLI reference](../cli.md).
