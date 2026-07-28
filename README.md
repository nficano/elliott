<div align="center">

# Elliott

### Compose secure personal AI agents from one universal primitive — the **Component**.

<p>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white">
  <img alt="Effect" src="https://img.shields.io/badge/Effect-4.0_beta-6E56CF?logo=effect&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/Bun-test_runner-F9F1E1?logo=bun&logoColor=black">
  <img alt="Status" src="https://img.shields.io/badge/status-Phases_1--3_complete-brightgreen">
  <img alt="License" src="https://img.shields.io/badge/license-UNLICENSED-lightgrey">
</p>

<em>Skills, tools, gateways, MCP endpoints, memory, model providers, evaluators — every one of them is a Component.<br>
One object model. Manifest-first discovery. Capability grants that narrow but never widen. Security enforced outside the model.</em>

</div>

---

## What is Elliott?

**Elliott is a standalone TypeScript framework for composing secure personal AI agents.** Every skill, tool, gateway, MCP endpoint, extension, interaction profile, memory provider, evaluator, model provider, and agent composition is represented as a single primitive: the **Component**.

Components implement schema-backed **Protocols**, are instantiated as scope-bound **Instances**, and receive revocable capability **Grants** brokered by the Elliott **AgentKernel**. There is no separate plugin system for each concern — there is one object model, and everything is an instance of it.

Elliott is distributed as a package that your own agent repositories install and compose. It is **not** a hosted SaaS, an orchestration UI, an MCP fork, or an autonomous self-modifying system.

## Why it exists

Personal AI agents run untrusted content through powerful tools on your behalf. That is a security problem wearing a productivity costume. Elliott treats it as a security problem first:

- **No ambient authority.** Components receive scoped handles and brokered grants, never the host environment.
- **Inference is not authorization.** Models may *suggest* actions; they can never grant permissions or bypass the capability broker.
- **External content is untrusted evidence.** Web pages, documents, email, and tool results never gain instruction precedence.
- **Security enforcement lives outside the model.** Policy, grants, approvals, sandboxing, secrets, and execution are deterministic runtime responsibilities.
- **Learning produces Proposals.** A running agent cannot directly rewrite active policy, skills, or executable components — changes go through review, canary, and rollback.

## Core ideas

### One object model

| Concept | Python analogy | Role |
| :------ | :------------- | :--- |
| **Component** | `object` | Universal base: identity, kind, version, digest, manifest, protocols, capabilities, lifecycle |
| **Protocol** | ABC / structural protocol | Narrow, schema-backed behavior (`tool.executor`, `model.inference`, `memory.reader`, …) |
| **ComponentSchema** | `type()` / `__class__` | Describes a kind, its manifest schema, and minimum required isolation |
| **ComponentInstance** | object instance | Definition + config + scope + principal + revocable grant handle + snapshot |
| **GrantSet** | — | Capabilities composed by **intersection**; resource limits by **element-wise minimum** |

> A narrower scope can **restrict** authority but never **expand** it. Grants are epoch-checked on every brokered call: revocation bites on the *next* call, with no time-to-live anywhere in the security plane.

### Orthogonal routing

Model selection is decoupled into three independent axes, so reading one `restricted` record doesn't permanently pin an entire session to local-only models:

```
Cognitive complexity   →   fast · balanced · deep          (the Profile)
Data classification    →   public < internal < confidential < restricted   (Privacy)
Economics              →   context window + cost metrics    (the Measure)
```

Agents request **profiles** (`fast`, `deep`), never provider-specific model names. **Residency is enforced by the kernel** through egress policy derived from each provider's network namespace — never inferred from a provider's self-description.

### Record always, restrict by posture

Bookkeeping (classification stamps, grants, digests, audit records) is **always on** because it is cheap and cannot be retrofitted. Enforcement machinery activates by posture — with *no semantic change or data migration* when an operator raises it.

| Concern | `standard` (default) | `hardened` | `regulated` |
| :------ | :------------------- | :--------- | :---------- |
| Classification lattice | single level (`internal`) | 3 levels | 4 levels |
| Sanitizer pipeline | dormant | Layer 1 on | Layers 1–3 + TLE |
| Residency filtering | pass-through | `confidential` enforced | `restricted` local-only |
| Audit (effect-gating) | durable-before-effect | same | same |

The `standard` posture runs the same code paths — they're just vacuous — so a fresh install is pleasant out of the box and hardening is *configuration, not surgery*.

## Architecture

Only five value shapes cross subsystem and process boundaries — everything else is composition:

```
Manifest      Envelope      Invocation      Grant      Record
 static        data          operation      brokered    immutable
 identity      carrier       request        authority   audit event
```

Discovery is **static and import-free**: the kernel scans manifests and package metadata, and never imports executable component code until an instance is bound into an isolated worker at first use.

## Module map

```
elliott
├── core            Component, Protocol, Schema, Instance, Registry, Snapshot, Epoch
├── security        grants · capability · policy · IFC · sanitizer · secrets · approvals · residency · broker
├── model           orthogonal routing · profiles · route tables · resolver · catalog · streaming
├── providers       first-party model providers (LiteLLM, Ollama)
├── manifest        Markdown / YAML / Agent Skills (SKILL.md) parsing & hardening
├── mcp             MCP endpoints, exposure, modern & legacy drivers
├── gateway         message source/sink pipelines with identity & session model
├── memory          session-store · curated · external-slot providers
├── learning        signals · curator · evaluation · proposals (the governed self-improvement loop)
├── audit           durability classes · shards · cross-linking
├── placement       warm pools · companions · cgroups
├── prompt          typed prompt architecture
├── scheduler       time-based invocation
├── observability   footprint attribution & regression gates
├── config          activation · postures
└── loop            the agent run loop
```

## Quick look

Components are defined statically — discovery never executes this code, it only reads the manifest:

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
await kernel.start(); // static, import-free discovery; instances stay cold until first brokered use
```

Profiles and residency are configured, not hardcoded into agents:

```yaml
# .elliott/models.yaml
profiles:
  fast:
    routes:
      - { provider: ollama,  model: llama3:8b,           priority: 1, costMetric: 0.00 }
      - { provider: litellm, model: gpt-4o-mini,          priority: 2, costMetric: 0.15 }
  deep:
    routes:
      - { provider: ollama,  model: command-r-plus:104b,  priority: 1, costMetric: 0.00 }
      - { provider: litellm, model: claude-3-5-sonnet,    priority: 2, costMetric: 3.00 }
```

## Getting started

```bash
bun install        # install dependencies
bun test           # run the conformance + unit suites
bun run typecheck  # tsc --noEmit
bun run lint       # eslint (with custom Effect + IFC rules)
bun run format     # dprint fmt
```

## Bundled skills and gateways

Elliott's first-party components live in [`skills/`](skills). The directory
contains the complete packages for web search and browsing, MCP, Slack,
Home Assistant, Gmail/email, BlueBubbles, webhooks, local files and execution,
SSH, fetch, cloudflared, and scheduling. Each package includes a
`manifest.yaml` authority manifest and its standard kind document.

The production entry point is Elliott-native: it discovers those packages,
connects configured MCP endpoints, exposes their tools to the model, and runs
the Slack Socket Mode gateway. The Slack package includes an importable
[`agent_view` manifest](skills/gateway-slack/slack-app-manifest.yaml) with
native streaming, task progress, contextual search, onboarding, feedback, and
thread controls. No second agent framework is vendored or loaded.

## Project status

Elliott is implemented across three cumulative phases (nothing in a later phase weakens an invariant established earlier):

- **Phase 1 — security kernel (complete):** component model, discovery, grant resolution with epochs, IFC frames, kernel-enforced residency, route tables, audit architecture, the `standard` posture.
- **Phase 2 — data plane breadth (complete):** memory providers, gateway and MCP pipelines, companions, sanitizer pipeline, `hardened`/`regulated` postures, scheduler, and bundled catalog.
- **Phase 3 — control plane (complete):** Proposal-based learning with separated authorities, transactional configuration activation, curator/learn loops, and compaction gates.

Conformance gates **G1–G25** each map to a design-document section and live under [`test/conformance`](test/conformance).

## Documentation

The authoritative design is the [Technical Design Document](docs) (Revision 6) — threat model, the component ontology, orthogonal routing, context-aware IFC, and the full conformance gate list.

## Built with

[**Effect**](https://effect.website) · [**TypeScript**](https://www.typescriptlang.org) · [**Bun**](https://bun.sh) · [**dprint**](https://dprint.dev) · a hardened ESLint config with custom rules for Effect idioms and information-flow safety.

---

<div align="center">
<sub>Elliott protects your data <em>from</em> components and providers — not from you.</sub>
</div>
