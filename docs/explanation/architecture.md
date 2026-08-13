# Architecture

Read this before changing anything, because the most common orientation mistake
in this repository is not knowing which of two layers you are standing in.

## Two layers share one tree

The **canonical framework** lives in `src/core`, `src/security`, `src/model`,
`src/learning`, `src/kernel.ts`, and their neighbors. It holds the component
model, the capability broker, the information-flow-control machinery, the
sanitizer pipeline, and governed self-evolution. This is the designed system.
Parts of its orchestrator are stubbed on purpose while the design settles.

The **production runtime** lives in `src/runtime/*`. It is the code that boots:
HTTP server, agent loop, skill loader, gateways, telemetry. It is simpler than
the canonical layer, and it adopts canonical machinery one piece at a time.
Governance arrived that way, and the SSH capability gate after it.

Nothing under `src/runtime/` imports `src/loop/` or `src/kernel.ts`. That is not
an accident of history; it is the seam that lets the canonical layer be redesigned
without breaking a running agent.

The awkward consequence is that a reader can find two answers to "how does
elliott do X" and both are true, of different layers. When that happens, the
runtime answer describes what runs today.

## elliott is not the deployable

What you deploy is a separate repository that installs elliott as a package and
boots `ElliottRuntime` against its own root. That repository owns `main.ts`, the
Dockerfile, the deploy job, the persona, and the agent's own skills. This one
only tests.

The split is why `frameworkRoot` and `agentRoot` are distinct parameters rather
than one directory. The framework's bundled `skills/` load from the installed
package; config, the agent definition, and agent-specific skills load from the
consumer checkout.

More on the reasoning:
[Framework skills vs. agent skills](framework-vs-agent-repos.md).

## One object model

A skill, a tool, a gateway, an MCP endpoint, a memory provider, a model
provider, an evaluator, an agent composition: each is a **Component**. Identity,
kind, version, digest, manifest, protocols, capabilities, lifecycle. Components
implement schema-backed **Protocols**, get instantiated as scope-bound
**Instances**, and receive revocable capability **Grants** brokered by the
**AgentKernel**.

There is no plugin system per concern, because a plugin system per concern is
how you end up with six places that grant authority and five of them are wrong.

Grants compose by intersection, and resource limits by element-wise minimum. A
narrower scope restricts authority; nothing widens it. Grants are epoch-checked
on every brokered call, so revocation takes effect on the next call and no TTL
appears anywhere in the security plane.

## Five shapes cross boundaries

```
Manifest      Envelope      Invocation      Grant      Record
 static        data          operation      brokered    immutable
 identity      carrier       request        authority   audit event
```

Everything else is composition. Keeping the boundary vocabulary this small is
what makes the audit trail mean anything: five shapes can be exhaustively
reasoned about, fifty cannot.

## Discovery never imports

The kernel and the runtime skill loader scan manifests. They do not import
executable component code to find out what it is. The runtime imports a skill
module only to call its `register()` at boot, and only when the manifest
declares an export.

The alternative, importing everything to see what it registers, means arbitrary
code runs before any policy has been consulted. Manifest-first discovery is what
lets the authority half be read before the behavior half exists in memory.

## How a boot proceeds

Config parses at the boundary and `${VAULT:…}` references resolve. A missing
secret omits the dependent skill rather than failing the boot.

The two-pass loader reads every `manifest.yaml` under `skills/` and
`agents/<name>/skills/`, registers facility providers first, then everyone else.
A throwing `register()` degrades that one skill.

Registered bindings assemble. Tools get collected and wrapped by the
`ToolGovernor` chokepoint. Routes and gateways attach to the HTTP server and the
agent loop. Services start.

Then the loop serves turns.

## How a turn proceeds

A gateway or a skill-registered route receives the message. The runtime
deduplicates by message id, keys the conversation on
`gateway:channel:thread`, rejects a second concurrent turn on that key, and pins
the snapshot id the turn started on.

The agent loops up to eight rounds, reassembling persona, fixed security
framing, and the current time each round. Tool calls pass the governor, and
`ssh_exec` additionally passes a capability gate backed by the real broker.

Results come back truncated to 30,000 characters and prefixed
`[UNTRUSTED TOOL OUTPUT]`. A third identical call within one turn gets a runtime
notice prepended ahead of that marker, which is the cheapest loop-breaker that
does not lie to the model about what happened.

The reply returns through the originating gateway when it can send, else through
the primary one.

## Orthogonal model routing

Model selection separates three axes: cognitive complexity (the profile),
data classification, and economics. Keeping them orthogonal is what stops a
single `restricted` record from pinning a session to local-only models for the
rest of its life.

Agents request profiles by name. They never name a provider model id, which is
why swapping providers is a config change rather than a code change.

## Record always, restrict by posture

Bookkeeping cannot be retrofitted onto a system that did not do it, so it is
always on and kept cheap: classification stamps, grants, digests, audit records.

Enforcement activates by posture. `standard`, `hardened`, `regulated`. Raising a
posture changes no semantics and migrates no data, because `standard` already
runs the same code paths, just vacuously.

Posture arrives as a constructor argument to `AgentKernel`, defaulting to
`standard`. CI has a three-job matrix meant to exercise all three, but nothing
reads the variable it sets, so the matrix does not yet test what it looks like
it tests. See [Testing strategy](testing-strategy.md).

## Where things live

```
src/core          component model, registry, snapshots, epochs
src/security      grants · capability · policy · IFC · sanitizer · secrets · broker
src/model         orthogonal routing, profiles, route tables
src/runtime       the production runtime (app, loop, skill loader, governance)
skills/           framework-bundled skill packages
agents/           agent definitions
config/           elliott.yaml + secrets.yaml, the config boundary
schemas/          JSON-Schema authorities
native/hot-core   Rust addon backing the linear-DFA scanner
test/conformance  one gate per design invariant
```

## Where the invariants are written down

In [`test/conformance/`](../../test/conformance/), and nowhere else. Each gate
asserts one invariant and the set is indexed in
[Conformance gates](../reference/conformance-gates.md). A design claim with no
gate behind it is a claim, not an invariant.

## Related

- [The security model](security-model.md)
- [Governance](governance.md)
- [Facilities](facilities.md)
