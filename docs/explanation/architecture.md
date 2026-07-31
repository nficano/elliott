# Architecture

This page explains how Elliott is put together and why the tree looks the
way it does. The authoritative, invariant-by-invariant design is the
[Technical Design Document](elliott-tdd.md) (Revision 7); this is the
orientation you read first.

## Two layers, one repository

Two layers share this tree, and confusing them is the most common
orientation mistake:

- **The canonical framework** (`src/core`, `src/security`, `src/model`,
  `src/learning`, `src/kernel`, …) — the component model, capability
  broker, IFC, sanitizer pipeline, and governed self-evolution. This is
  the designed system; parts of its orchestrator are intentionally
  stubbed while the design settles.
- **The production runtime** (`src/runtime/*`) — the code that actually
  boots: HTTP server, agent loop, skill loader, gateways, telemetry. It
  is deliberately simpler than the canonical layer and adopts canonical
  machinery piece by piece (governance was wired in this way — see
  [Agent governance](agent-governance.md)).

Deployment happens from a separate consumer repository (the agent repo),
which installs Elliott as a package and boots `src/runtime/main.ts` with
its own agent definition and skills. Elliott itself is a framework, not a
deployable app.

## One object model

Every capability — skill, tool, gateway, MCP endpoint, memory provider,
model provider, evaluator, agent composition — is a **Component**:
identity, kind, version, digest, manifest, protocols, capabilities,
lifecycle. Components implement schema-backed **Protocols**, are
instantiated as scope-bound **Instances**, and receive revocable
capability **Grants** brokered by the **AgentKernel**. There is no
separate plugin system per concern.

Grants compose by **intersection** (resource limits by element-wise
minimum): a narrower scope can restrict authority but never expand it.
Grants are epoch-checked on every brokered call, so revocation bites on
the next call with no TTL anywhere in the security plane.

## Five value shapes

Only five shapes cross subsystem and process boundaries — everything else
is composition:

```
Manifest      Envelope      Invocation      Grant      Record
 static        data          operation      brokered    immutable
 identity      carrier       request        authority   audit event
```

## Import-free discovery

Discovery is static: the kernel and the runtime skill loader scan
manifests (`manifest.yaml`, package metadata) and never import executable
component code until an instance is bound at first use — the runtime
loader imports a skill module only to call its `register()` at boot, and
only if the manifest declares an export.

## The runtime boot path

1. Config is parsed at the boundary; `${VAULT:…}` secret references are
   resolved. A missing secret omits the dependent skill rather than
   failing the boot.
2. The two-pass skill loader reads every `manifest.yaml` under `skills/`
   and `agents/<name>/skills/`, registers facility **providers** first,
   then everything else. A throwing `register()` degrades that skill;
   boot continues.
3. Registered bindings are assembled: tools are collected (and wrapped by
   the `ToolGovernor` chokepoint — policy, principal attribution,
   digest-only audit record, runtime kill switch), routes and gateways
   attach to the HTTP server and agent loop, services start.
4. The agent loop serves turns. Everything a model reads is executable
   context, so tool and gateway output enters the loop as
   `[UNTRUSTED …]`-framed evidence, never as instructions.

## Orthogonal model routing

Model selection decouples three axes so one `restricted` record does not
pin a session to local-only models forever: cognitive complexity (the
profile: `fast` / `standard` / `deep`), data classification (`public` <
`internal` < `confidential` < `restricted`), and economics (context
window + cost). Agents request profiles, never provider model names;
residency is enforced by the kernel through egress policy.

## Record always, restrict by posture

Bookkeeping (classification stamps, grants, digests, audit records) is
always on. Enforcement activates by posture — `standard`, `hardened`,
`regulated` — with no semantic change or data migration when an operator
raises it. The `standard` posture runs the same code paths, just
vacuously, which is why CI runs the suite in all three postures.

## Where things live

```
src/core          component model, registry, snapshots, epochs
src/security      grants · capability · policy · IFC · sanitizer · secrets · approvals · residency · broker
src/model         orthogonal routing, profiles, route tables
src/runtime       the production runtime (app, loop, skill loader, governance)
skills/           framework-bundled skill packages (manifest + register())
agents/           agent definitions; consumer repos add agents/<name>/skills/
config/           elliott.yaml + secrets.yaml (the config boundary)
schemas/          JSON-Schema authorities (component manifest, topology)
test/conformance  one gate per TDD invariant (G1–G26)
```

## Related

- [Design decisions](design-decisions.md) — the doctrine behind these
  shapes
- [Skill facilities](skill-facilities.md) — how skills provide
  infrastructure to each other
- [Skills registry](skills-registry.md) — installable skills
- [deep-trace](../../skills/deep-trace/README.md) — the observability map
  over this architecture
