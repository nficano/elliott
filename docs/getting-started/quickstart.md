# Quickstart

This page gets you from a fresh install to a defined component and a booted
runtime in a few minutes. It assumes you completed
[Installation](installation.md).

## Define a component

Every capability in Elliott — skill, tool, gateway, memory provider, model
provider — is a **Component**. Components are defined statically; discovery
reads the manifest and never imports executable code until first brokered
use:

```typescript
import { defineComponent } from "elliott/core";
import { AgentKernel } from "elliott";

const echo = defineComponent(
  {
    manifest: {
      ref: "workspace/tool/echo",
      schema: { kind: "tool", apiVersion: "elliott/v1", digest },
      // requested capabilities, protocols, limits, provenance …
    },
  },
  ({ instance, config, context }) => new EchoTool(instance, config, context),
);

const kernel = new AgentKernel();
await kernel.start(); // static, import-free discovery
```

## Boot the production runtime

The runtime that actually serves an agent (HTTP server, agent loop, skill
loader, gateways, telemetry) lives in `src/runtime/`:

```bash
bun run start   # bun src/runtime/main.ts
bun run dev     # same, with ELLIOTT_ENV=dev
```

The runtime reads `config/elliott.yaml` and `config/secrets.yaml` at the
config boundary. Secrets are opaque `${VAULT:path#field}` references — a
missing Vault field is not fatal: the skills that need it stay unregistered
while the rest of the runtime boots. See
[Configuration](../reference/configuration.md) for every key.

## Scaffold instead of hand-writing

The `elliott` CLI scaffolds the common shapes:

```bash
bunx elliott new skill my-skill    # a skills/-style package
bunx elliott new tool my-tool
bunx elliott new agent my-agent    # a consumer agent repository
```

See the [CLI reference](../reference/cli.md) for all commands.

## Where to go next

- Build something real: [Your first skill](../tutorials/your-first-skill.md)
- Understand what you just booted:
  [Architecture](../explanation/architecture.md)
- Task recipes: [How-to guides](../index.md#how-to-guides)
