# Technical Design Document: Elliott Component Model, Orthogonal Routing, and Context-Aware IFC

**Revision 6.** This revision restores the foundational material from the original (Revision 1) TDD that fell away across Revisions 2–5, without altering any decision made since: product goals, non-goals, and design principles (§0f); the narrow-waist runtime primitives (§2c); compact capability discovery (§3b); custom profile namespacing (§5a) and the model use policy with governed escalation (§5e); secrets and approvals (§8c, §8d); the full Markdown/YAML hardening list and an example skill overlay (§9, §9b); AgentTopology and the typed prompt architecture (§10, §10a); expanded learning-loop authorities, signal ranking, Proposal storage, evaluation stages, and promotion (§11c); compaction causal blocks and the three footprint budgets (§11d); memory routing taxonomy (§14d); gateway pipelines with identity and session model (§14f); the MCP architecture with virtual child components and the protocol version seam (§14g); nomenclature and naming conventions (§15); repository, platform-state, and component directory conventions with full manifest examples (§16); TypeScript standards (§16d); and rollout milestones, open questions, and the final architecture summary (§17). Where Revision 1 and later revisions conflict (Facet→Component, Persona→InteractionProfile, four reserved profiles→three plus orthogonal residency, LiteLLM-coupled→provider-neutral, single LLM declassifier→sanitizer pipeline), the later revision stands and §15 records the mapping. Throughout the document, **Taint is renamed SecurityTag** (`TaintRecord`→`SecurityTag`, `taints`→`securityTags`).

## Executive Summary

Elliott is a standalone TypeScript framework for composing secure personal AI agents from one universal primitive: the **Component**. Every skill, tool, gateway, MCP endpoint, extension, interaction profile, memory provider, evaluator, model provider, and agent composition is represented as a Component. Components implement schema-backed Protocols, are instantiated as scope-bound Instances, and receive revocable capability Grants through the Elliott AgentKernel.

The architecture emphasizes static, manifest-first discovery; strict Information Flow Control (IFC) via a hierarchical context stack with kernel-assigned classifications; and Provider-Neutral Orthogonal Routing, which decouples cognitive complexity (Model Profiles) from data privacy (Residency) and economics (Cost). Residency is enforced by the kernel through egress policy, never inferred from provider self-description.

The performance doctrine (§0d) governs every mechanism: security checks keep check-at-moment-of-use _semantics_ while shedding check-at-moment-of-use _mechanism_. Expensive policy computation runs when policy changes; the per-call path runs a constant-time staleness test. Because every mutable input in this design already flows through an explicit, auditable event (digests, epochs, Proposals, transactional activation), the invalidation signals exist without new trust assumptions.

The default posture doctrine (§0e) governs what a fresh install pays for: **record always, restrict by posture.** Bookkeeping (classification stamps, grants, digests, audit records) is always on because it is cheap and because retrofitting it is impossible. Enforcement machinery that most users never need (multi-level IFC, sanitizers, TLE, residency filtering) is dormant under the `standard` posture and activates without semantic change or data migration when an operator raises the posture.

## 0. Threat Model, Non-Goals, and Scope

Every security mechanism in this document is justified against a named adversary. A mechanism that does not trace to a row in the table below should be treated as accidental complexity and challenged in review.

### 0a. Adversaries

| ID     | Adversary                                           | Capabilities assumed                                                                                                                          |
| :----- | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Malicious or compromised skill/tool author          | Ships arbitrary manifest text and module code; controls tool outputs returned to the agent.                                                   |
| **A2** | Adversarial content in tool results                 | Web pages, documents, and emails containing prompt injection aimed at the agent or at any LLM in the pipeline, including sanitizers.          |
| **A3** | Compromised or misconfigured model provider         | Lies in its catalog (capabilities, cost, locality); logs or exfiltrates request payloads; returns adversarial completions.                    |
| **A4** | Compromised session or agent instance               | Holds legitimately issued grants; attempts to exceed them, retain them after policy change, or launder data across classification boundaries. |
| **A5** | Curious or negligent operator of a shared workspace | Reads what the UI shows; does not tamper with the host OS.                                                                                    |

### 0b. Explicit non-goals

- **Host compromise (root on the machine running the AgentKernel) is out of scope.** The kernel, its policy store, its caches (§0d), and its audit log are the trusted computing base (TCB).
- **A malicious primary user is out of scope.** Elliott protects the user's data from components and providers, not from the user.
- **Covert channels below the payload level are mitigated, not eliminated.** A restricted-frame agent can leak low-bandwidth signals through control flow: whether it merges, which tools it calls, timing, and message counts. Section 6d states the residual risk and the rate-limiting mitigations. Any claim elsewhere that IFC "prevents exfiltration" means payload-level exfiltration.

### 0c. Delivery phasing

The full component taxonomy is large. The design cuts into three phases so that the security kernel ships and hardens first:

1. **Phase 1 (security kernel):** Component model, discovery, GrantSets with epoch resolution, IFC frames, kernel-enforced residency with egress probes, route tables and model resolution, audit log architecture, the `standard` posture and container deployment profile, gates G1–G11 and G16–G22.
2. **Phase 2 (data plane breadth):** Memory providers with persisted classification, MCP exposure, extension/gateway kinds, sanitizer pipeline with decision caching, `hardened`/`regulated` postures, the bundled catalog (§14: search, browser, gateways, scheduler, OS tools, cloudflared, hermes-method memory stores), gates G12–G15 and G23–G25.
3. **Phase 3 (control plane):** Proposal-based learning, transactional configuration activation, compaction gates.

Nothing in Phase 3 may weaken an invariant established in Phase 1; Phase 3 features are additive consumers of the kernel, not modifications to it.

### 0d. Performance Doctrine: event-driven recomputation, epoch-checked use

Revision 2 phrased its guarantees as recomputation at the moment of use: resolve the GrantHandle on every brokered call, run the seven-step route filter on every inference, hash-chain-and-fsync every audit record inline. The guarantees are correct; the mechanism over-pays. Revision 3 adopts one rule everywhere:

> **A security decision may be served from a cache if and only if (a) the cache key covers every input to the decision, (b) each input is versioned by a digest or a monotonic epoch, and (c) the per-use path verifies version currency before serving.** A version mismatch forces synchronous recomputation on that same call. There is no time-to-live anywhere in the security plane; staleness is defined by version, never by clock.

Consequences:

- **Epochs are TCB state.** The kernel owns a set of monotonic epoch counters (per scope, plus one global). Policy changes, GrantHandle revocations, configuration activations (§11b), catalog updates, ResidencyGrant changes, and Proposal deployments each bump the epochs whose consumers they can affect. Epoch bumps are audit events.
- **Semantics are unchanged, verbatim.** "Revocation takes effect on the next brokered call" (G6) holds because the next brokered call performs the epoch comparison, detects the bump, re-resolves, and receives `GrantRevokedError`. The cache changes when work happens, not what the caller observes.
- **Caches never widen authority.** A cache miss, a version mismatch, or a corrupted cache entry falls back to full recomputation, and full recomputation retains all fail-closed behavior. A cache failure can slow a request; it cannot approve one.
- **Conformance is testable.** Gates G17–G20 (§13) test the caching layer itself: that no stale grant survives an epoch bump, that route tables and live filtering agree, that sanitizer cache keys cover the full policy input, and that durability ordering holds for effect-gating audit records.

Every mechanism introduced in Revision 3 cites this doctrine rather than restating it.

### 0e. Default Posture Doctrine: record always, restrict by posture

Revision 2–3 machinery was specified at full strength. Full strength is the wrong default: most installations are one user on one machine with no `confidential` data, no regulator, and no appetite for sanitizer review queues, and every enforcement layer they don't need costs latency they do notice. But naive feature flags create the classic hole: enforcement turned on later cannot protect data whose provenance was never recorded. The doctrine that resolves this:

> **Bookkeeping is unconditional; enforcement is posture-scoped.** The kernel always writes classification stamps, frame marks, GrantSet resolutions, digests, epoch bumps, and audit records, under every posture, because they are cheap (an enum, a hash, a queued record) and cannot be retrofitted. What a posture selects is which _constraints derived from that bookkeeping_ are enforced. Raising the posture therefore changes what is permitted, never what is known.

**The three postures.** A posture is workspace/org configuration, changed through a §11c Proposal, activated transactionally (§11b, so it is one epoch bump).

| Concern                                                                 | `standard` (default)                                                             | `hardened`                         | `regulated`                                               |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :--------------------------------- | :-------------------------------------------------------- |
| Classification lattice                                                  | Single level: everything is `internal`                                           | `public < internal < confidential` | Full: `public < internal < confidential < restricted`     |
| IFC frames & marks                                                      | Structurally active, trivially satisfied (one level ⇒ no upward boundary exists) | Active across three levels         | Active across four levels                                 |
| Sanitizer pipeline & merges                                             | Dormant (no boundary to cross; merges are Stage-3-only, §6c)                     | Layer 1 on; Layer 2 optional       | Layers 1–3 on; TLE required                               |
| TLE (`audit-local` profile)                                             | Not installed                                                                    | Optional                           | Required, local residency                                 |
| Residency filtering (§5d step: table build)                             | Pass-through (no classification requires residency)                              | Enforced for `confidential`        | Enforced; `restricted` is local-only                      |
| ResidencyGrant recording & egress probes (§12b)                         | **Always on**                                                                    | Always on                          | Always on, tighter cadence                                |
| Memory stamps (§6b)                                                     | **Always written** (as `internal`)                                               | Always written                     | Always written                                            |
| Audit: effect-gating records (§12a)                                     | **Always durable-before-effect**                                                 | Same                               | Same                                                      |
| Audit: observational records                                            | Sampled                                                                          | Full                               | Full, extended retention                                  |
| Isolation floors (§2a)                                                  | **Unchanged** (warm pools make them cheap)                                       | Unchanged                          | Unchanged; `container`+ recommended for third-party kinds |
| Org pinning, fail-closed registration, broker mediation, kind integrity | **Always on**                                                                    | Same                               | Same                                                      |
| Deferred grants                                                         | JIT approval, remembered at workspace scope                                      | JIT approval per session           | JIT approval per invocation class, operator-visible queue |

Rows marked **always on** are the non-negotiables: they are either event-time (registration, activation) or already constant-time on the hot path, so turning them off buys nothing measurable and forfeits the upgrade path.

**Why single-level, not disabled.** Under `standard`, the IFC code path runs but the lattice makes it vacuous: every frame's high-water mark is `internal`, every source stamps `internal`, `max()` is a no-op, the route-table residency filter prunes nothing, and no merge ever crosses a boundary, so the sanitizer pipeline is never invoked. Cost approaches zero without a single dormant branch that could hide a bug, and conformance tests exercise the same code under every posture.

**Why upgrades are safe.** Because stamps were written from the first record, widening the lattice is the already-specified taxonomy migration (§6b): a Proposal with a mapping table (`internal → internal` is the identity mapping). No historical record is unmarked, so no historical record can launder. The reverse direction is restricted: lowering a posture never relabels existing stamps; records keep their marks and the wider-lattice records remain enforced at their stamped level. Gate G22.

**What this costs at `standard`.** The per-inference path is: epoch check, single-key table lookup, budget check, dispatch. The per-tool-call path is: epoch check, incremental scan (trivial pattern set), dispatch. The per-merge path is: Stage 3 application. No LLM other than the one the user asked for runs, ever.

### 0f. Goals, Non-Goals, and Design Principles

**Goals.**

- One universal primitive with introspection and secure layering built in.
- Markdown and YAML as foundational component formats.
- Native Agent Skills compatibility through unmodified `SKILL.md` files.
- Pluggable gateways, MCP endpoints, extensions, interaction profiles, memory providers, model providers, evaluators, and schedulers expressed through the same object model.
- Runtime equivalents of Python's `object`, `type()`, ABCs, structural protocols, `isinstance()`, `dir()`, `inspect.signature()`, and `help()`.
- A capability model where every narrower scope can restrict but never expand authority.
- Provider-neutral model selection with reserved semantic profiles; first-party provider components (LiteLLM, Ollama) without delegating tool authority to any provider.
- A governed self-improvement loop with evaluation, provenance, human review, canary activation, and rollback.
- Prompt, inference, and runtime footprint attribution with regression gates.
- Distribution as a standalone package that separate agent repositories install and compose.
- A `standard` posture that is genuinely pleasant out of the box, with hardening as configuration rather than surgery (§0e).

**Non-goals.**

- Not a hosted SaaS platform, and not an orchestration UI.
- Not a replacement for LiteLLM, Langfuse, Vault, Home Assistant, or other external infrastructure.
- Not an MCP fork or replacement.
- Not implemented in Python; Python is an object-model analogy only.
- Not a consumer-agent monorepo.
- Not an autonomous self-modifying system without approval boundaries.
- Not a generic in-process plugin host for untrusted third-party code.

**Design principles.**

1. **One object model.** Skills, tools, gateways, MCP endpoints, interaction profiles, model providers, and evaluators are Component kinds rather than separate plugin systems.
2. **Behavior through Protocols.** New behavior is added through narrow schema-backed Protocols before adding new inheritance layers or managers.
3. **Static discovery.** Discovery reads manifests and package metadata. It never imports executable component code.
4. **No ambient authority.** Components receive scoped handles and brokered Grants, not the host environment.
5. **Immutable runtime snapshots.** Every run resolves against one fixed Snapshot. Mid-run changes apply only to future Snapshots (grant _revocation_ still bites mid-run via epochs, §1a; a snapshot fixes identity and configuration, never preserves revoked authority).
6. **External content is untrusted evidence.** Gateway input, MCP output, files, websites, email, and tool results never gain instruction precedence.
7. **Inference is not authorization.** Models may suggest actions but cannot grant permissions or bypass the capability broker.
8. **Learning produces Proposals.** The running agent cannot directly rewrite active policy, skills, interaction profiles, model profiles, or executable components.
9. **Model profiles express intent.** Agents request stable profiles such as `fast` or `deep`, not provider-specific model names.
10. **Security enforcement is outside the model.** Policy, grants, approvals, sandboxing, secrets, and execution remain deterministic runtime responsibilities.

**Core security invariants.** Restated compactly; each is specified in full where cited:

1. No ambient authority (§9, FacetContext-successor `ComponentContext`).
2. No untrusted third-party code in the kernel process (§2a).
3. Skills and interaction profiles cannot grant permissions (§9, §10).
4. Control-plane files are protected from direct agent mutation (§11b, §11c).
5. Secrets are opaque references and never enter model context (§8c, §14b).
6. Runs use immutable Snapshots (§2, §11b).
7. Authorization is rechecked at every boundary (§1a: epoch-checked, semantics unchanged).
8. Scanners are advisory; OS isolation is the containment boundary (§2a, §12b).
9. Untrusted content remains security-tagged (§6).
10. The author of a change cannot approve or promote that change alone (§11c).

## 1. Core Ontology

**Component**
The universal base object. A Component has stable identity, kind, version and digest, manifest, documentation, declared Protocols, requested capabilities, lifecycle, and introspection.

**Protocol**
The equivalent of a Python ABC or structural protocol. Examples: `message.source`, `message.sink`, `tool.executor`, `resource.reader`, `prompt.source`, `model.inference`, `model.catalog`, `policy.decider`, `health.checker`, `evaluation.runner`, `memory.reader`, `memory.writer`, `composition.members`. A Component can implement multiple Protocols.

**ComponentSchema**
The runtime equivalent of `type()` or `__class__`. It describes the component kind, manifest schema, standard Markdown document, supported Protocol schemas, minimum required isolation, and lifecycle rules. Manifests reference their schema by `(kind, apiVersion, digest)`; they do not embed it (§2).

**ComponentInstance**
The runtime equivalent of an object instance. It combines a Component definition with configuration, scope, principal, a revocable GrantHandle, runtime snapshot, health state, lifecycle state, and an explicit IPC transport contract for cross-boundary communication.

**GrantSet**
A GrantSet has two parts with different algebras (adversary A4):

- **Capabilities** (set-valued): composed by intersection.
  `effective capabilities = component requests ∩ package trust ceiling ∩ organization policy ∩ workspace policy ∩ agent policy ∩ principal authority ∩ session restrictions`
- **Resource limits** (quantitative: token budgets, cost ceilings, rate limits): composed by element-wise minimum.
  `effective limit = min(org limit, workspace limit, agent limit, session limit, invocation budget)`

Budgets are not capabilities; conflating them in one intersection produces undefined behavior at the type level. In containerized deployments (§12b), OS-enforceable limits (CPU, memory, pids, I/O bandwidth) are compiled into cgroup settings on the instance's container at placement time, so the OS enforces them with zero broker involvement; the kernel remains the sole enforcer of limits the OS cannot see (token budgets, cost ceilings, per-frame rate limits). The kernel exposes a `grants.explain(instance, capability)` introspection that reports, per capability, which policy source removed it. Intersection across seven sources is undebuggable without this. `grants.explain` always runs against a fresh resolution, never against the cache (§1a), so its output reflects current policy even mid-epoch.

**GrantHandle and revocation.** Instances hold a GrantHandle, not a raw GrantSet. The kernel resolves the handle on every brokered call, using the epoch-checked resolution of §1a. Policy changes and session revocations take effect on the next brokered operation without instance restart; an instance whose handle is revoked receives `GrantRevokedError` and transitions to `draining`. A snapshot of the resolved GrantSet at issue time is retained for audit only.

### 1a. Epoch-invalidated grant resolution

The seven-source intersection and five-source minimum are recomputed only when an input changes (doctrine §0d).

- Each resolved GrantSet is cached per GrantHandle, tagged with the epoch vector of the scopes contributing to it: `(org epoch, workspace epoch, agent epoch, session epoch, principal epoch)`.
- Any change to a contributing policy source, any revocation, and any configuration activation (§11b) bumps the corresponding epoch counter.
- The brokered-call fast path is: load cached entry, compare its epoch vector against current counters (a handful of atomic reads), serve on match. On mismatch, the same call performs full seven-source resolution, stores the new entry with the new vector, and proceeds under the fresh result. A revoked handle resolves to the revoked state and the call fails with `GrantRevokedError`, exactly as in Revision 2.
- Resource-limit _consumption_ (token counters, spend accumulators) is never cached; it is live mutable state. Only the resolved _limits_ are cached.
- Cache entries live inside the kernel process. Isolated components never hold resolved GrantSets; they hold handles, and every enforcement decision stays behind the broker. The cache therefore adds no new attack surface beyond the TCB (§0b) it already lives in.

Conformance: gate G17.

**Composition**
Composition is a relationship, not a security inheritance layer. An InteractionProfile, Agent, Extension, or AgentTopology can implement `composition.members`, but membership does not transfer authority.

`child effective ceiling = parent ceiling ∩ child requests ∩ child policy`

**Least-privilege pressure.** Static manifest capability requests trend toward over-requesting (the Android-manifest failure mode, adversary A1). Two countermeasures: (1) the registry computes a _usage delta_ between requested and actually-brokered capabilities per release and surfaces it in review tooling; (2) grants may carry `deferred: true`, meaning the capability is requested statically but only activated after a just-in-time operator approval on first use. Activation of a deferred grant bumps the holding instance's session epoch, so the cached resolution refreshes on the next call without special-casing.

## 2. TypeScript Object Model & IPC Data Plane

```typescript
export type ComponentKind =
  | "agent"
  | "skill"
  | "tool"
  | "resource"
  | "gateway"
  | "mcp-endpoint"
  | "mcp-exposure"
  | "extension"
  | "interaction-profile"
  | "memory"
  | "policy"
  | "evaluator"
  | "model-provider"
  | "model-profile"
  | "scheduler";

/** Kinds that participate in security decisions. Subject to org pinning (§3)
 *  and elevated isolation minimums (§2a). */
export type SecurityCriticalKind =
  | "policy"
  | "evaluator"
  | "gateway"
  | "model-provider";

export type IsolationLevel =
  | "declarative"
  | "in-process"
  | "process"
  | "container"
  | "remote";

/** Monotonic counters owned by the kernel. See §0d and §1a. */
export type Epoch = number & { readonly __brand: unique symbol };

export interface EpochVector {
  readonly org: Epoch;
  readonly workspace: Epoch;
  readonly agent: Epoch;
  readonly session: Epoch;
  readonly principal: Epoch;
}

export interface ComponentSchema {
  readonly kind: ComponentKind;
  readonly apiVersion: string;
  readonly digest: Digest;
  readonly documentName: string;
  readonly manifestSchema: JsonSchema;
  /** Floor, not default. The kernel refuses instantiation below this level. */
  readonly minimumIsolation: IsolationLevel;
}

export interface SchemaRef {
  readonly kind: ComponentKind;
  readonly apiVersion: string;
  readonly digest: Digest;
}

export interface ComponentManifest {
  readonly ref: ComponentRef;
  /** Reference, not embedded schema. Two manifests of the same kind cannot
   *  disagree about their own schema; the registry resolves the ref once. */
  readonly schema: SchemaRef;
  readonly version: string;
  readonly digest: Digest;
  readonly description: string;
  readonly protocols: readonly ProtocolDescriptor[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly requestedLimits: ResourceLimitRequest;
  readonly provenance: Provenance;
}

export type LifecycleState =
  | "created"
  | "opening"
  | "open"
  | "draining"
  | "closed"
  | "failed";

export interface ComponentInstance {
  readonly manifest: ComponentManifest;
  readonly scope: Scope;
  readonly principal: PrincipalId;
  readonly configDigest: Digest;
  readonly grants: GrantHandle;
  readonly snapshot: SnapshotId;
  readonly lifecycle: LifecycleState;
  /** Placement decided by the kernel per §2b; never self-selected. */
  readonly placement: PlacementRef;
  readonly transport?: {
    /** Wire transport and RPC framing are separate layers. */
    readonly wire: "unix-socket" | "tcp" | "websocket";
    readonly framing: "grpc" | "trpc";
    readonly endpoint: string;
  };
}

export abstract class Component<
  Kind extends ComponentKind = ComponentKind,
  Config = unknown,
> {
  protected constructor(
    public readonly instance: ComponentInstance,
    protected readonly config: Readonly<Config>,
    protected readonly context: ComponentContext,
    expectedKind: Kind,
  ) {
    // Runtime check replaces the previous unchecked `as Kind` cast, which let
    // a Component<"tool"> wrap an agent manifest and still type-check.
    if (instance.manifest.schema.kind !== expectedKind) {
      throw new ComponentKindMismatchError(
        expectedKind,
        instance.manifest.schema.kind,
      );
    }
  }

  public get manifest(): ComponentManifest {
    return this.instance.manifest;
  }

  public get kind(): Kind {
    return this.manifest.schema.kind as Kind; // safe: verified in constructor
  }

  public supports(protocol: ProtocolId): boolean {
    return this.manifest.protocols.some(
      (candidate) => candidate.id === protocol,
    );
  }

  public inspect(
    view: "model" | "operator" | "debug" = "model",
  ): ComponentInspection {
    return createComponentInspection(this, view);
  }

  /** Lifecycle is a state machine enforced by the kernel, not empty hooks.
   *  Legal transitions: created→opening→open→draining→closed; any state→failed.
   *  open() on non-created, close() on non-open, and double-close all throw
   *  LifecycleTransitionError. A failed open() lands in `failed`, never `open`.
   *  Because instances hold grants, lifecycle bugs are security bugs; the
   *  kernel releases the GrantHandle on entry to `closed` or `failed`. */
  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}
}
```

### 2a. Isolation and the trust boundary

Grants are only _enforced_ at a process boundary or stronger. For `declarative` and `in-process` components, the GrantSet is a contract checked at broker call sites, but the component shares memory with the kernel and could bypass the broker. Therefore:

- `declarative` and `in-process` components are **part of the TCB by definition**. Only first-party built-ins and org-pinned components may use these levels.
- Any component that can observe frame content classified `confidential` or above requires `process` isolation or stronger.
- `SecurityCriticalKind` components require `process` isolation minimum regardless of classification exposure.
- `minimumIsolation` in the schema is a floor the kernel enforces at instantiation; operators can raise it per scope, never lower it.

### 2b. Placement: paying for isolation once, not per call

The floors above stand unchanged. The cost of meeting them is engineered down four ways (doctrine §0d: spawn cost is recomputation cost, and instantiation events are the change events):

**Warm sandbox pools.** The kernel maintains pre-forked generic isolation containers per `IsolationLevel`. Instantiation binds a component module into a pooled sandbox instead of cold-spawning one. The G3 manifest/runtime comparison still executes inside the isolated worker before the instance is registered; pooling amortizes the spawn, it does not skip the check. Pool sizes are operator-tunable per scope; pool exhaustion falls back to cold spawn, never to a weaker isolation level.

**Snapshot cold-start.** Components instantiated frequently may publish a V8 snapshot or container checkpoint. The snapshot is bound to the manifest digest and config digest; a digest mismatch discards the snapshot and falls back to a full import, so G3 semantics hold byte-for-byte. Snapshots of `SecurityCriticalKind` components additionally require org-pinned provenance.

**Security-context cohabitation.** Two components may share a process only when their security contexts are identical: same effective grant ceiling, same maximum classification exposure, same trust domain, same scope. The trust boundary in this design runs between security contexts, not between component instances, so cohabitation within one context moves no boundary. Constraints:

- Cohabitation is an explicit placement decision recorded in the instance's `placement` and in the audit log; it is never a default.
- No cohabitation across a `SecurityCriticalKind` line, in either direction.
- A policy change that makes two cohabiting contexts diverge (an epoch bump that changes either effective ceiling) forces re-placement: the kernel drains one occupant to its own sandbox before the next brokered call under the new policy completes. Divergence detection rides the same epoch comparison as §1a.

**Lazy instantiation.** Discovery is already static and import-free (§3), so registration does not require a live instance. Instances stay cold until first brokered use; first use draws from the warm pool, bounding first-call latency. Lifecycle events (`created→opening→open`) fire at first use exactly as they would at eager start.

Conformance: G4 unchanged; new assertions under G17 cover re-placement on context divergence.

### 2c. Narrow-waist runtime primitives

Only five value shapes cross subsystem and process boundaries; everything else is composition:

```text
Manifest    Envelope    Invocation    Grant    Record
```

**Envelope.** The common data carrier for messages, events, resources, tool results, and feedback. Actor trust and content trust are independent fields: an authenticated principal can deliver untrusted content, and both facts survive the hop.

**Invocation.** An immutable operation request: principal, agent, target component, protocol and operation, validated input, schema digests, origin and securityTags, requested capabilities, deadline and budget, snapshot, and optional prepared-plan digest.

**Grant.** The brokered, invocation-scoped materialization of a GrantHandle resolution (§1a): principal, capability, resource, invocation, constraints, expiration, policy decision, and optional approval reference. A Grant is what a single boundary crossing carries; the GrantSet/GrantHandle machinery of §1 is where it comes from. Grants are never stored by components and never outlive their invocation.

**Record.** An immutable event used for audit, replay, debugging, evaluation, learning, and observability, stored per the durability classes of §12a.

## 3. Component Registration & Discovery

Filesystem discovery is authoritative. Installed packages advertise Components through static package metadata; workspace Components are scanned from configured roots. Runtime code is never imported during discovery.

```typescript
export interface ComponentModule<Config> {
  readonly definition: ComponentDefinition<Config>;
  create(input: {
    readonly instance: ComponentInstance;
    readonly config: Readonly<Config>;
    readonly context: ComponentContext;
  }): Component;
}

export function defineComponent<Config>(
  definition: ComponentDefinition<Config>,
  factory: ComponentModule<Config>["create"],
): ComponentModule<Config> {
  validateDefinition(definition);
  return Object.freeze({ definition, create: factory });
}
```

**Lifecycle:**
`scan trusted roots → parse static manifests → validate → resolve provenance → calculate grants → create isolated worker → import declared module → compare runtime contract to static manifest → register instance`

**Manifest/runtime mismatch fails closed.** The comparison step hashes the runtime-reported contract (protocols, capability requests, schema ref) and requires byte equality with the static manifest. Any mismatch aborts registration, quarantines the package (its components resolve as `unavailable`, never as absent, so a lower-priority component cannot silently take its place), and emits an audit event. This closes the TOCTOU window between static scan and module import (adversary A1).

### 3a. Validation caching by package digest

Cold boot of a large workspace previously re-validated every package: parse, schema-validate, provenance-resolve, hash-compare. The package digest is already the identity primitive, so it is also the cache key (doctrine §0d):

- A successful validation stores `(package digest, schema digests consulted, provenance verdict, runtime-contract hash)` in the kernel's validation cache.
- On boot, a package whose digest matches a cache entry skips re-parsing and re-verification of provenance; the isolated-worker import and runtime-contract comparison for _instantiation_ are untouched, because those defend a different window (post-registration substitution is impossible when the digest matches, but instantiation-time G3 remains the gate for the module actually loaded).
- Any change to a consulted schema digest, to provenance trust roots, or to the validation logic version invalidates the entry. Quarantine verdicts are cached too: a quarantined digest stays `unavailable` without re-running the failed validation, and un-quarantining requires an explicit operator action that evicts the entry.

**Resolution Order (Last Writer Does NOT Win):**
`invocation > session > agent > workspace > user > organization > builtin`

A same-scope collision is an error. A higher-precedence scope can intentionally shadow a lower one, and the shadowing must be visible in the lockfile and introspection output, with one exception:

**Org pinning for security-critical kinds.** For `SecurityCriticalKind` components and any component named in an org `pin` directive, resolution order inverts: `organization > workspace > ...`, and narrower scopes cannot shadow at all. Without this rule, a session-scoped component could shadow the org's policy decider or sanitizer, and lockfile visibility would detect the attack only after it succeeded (adversary A4). Pinning is prevention; the lockfile is forensics.

### 3b. Compact capability discovery (model-facing)

The model should not receive every complete operation schema at startup; that is both a footprint problem (§11d) and an injection surface (every schema description is manifest text, adversary A1). Initial model-visible cards contain only: ref, kind, description, operation summaries, risk, and availability. The model-facing discovery surface is three operations:

```text
component.search → component.inspect → component.call
```

Flow: search compact descriptors → inspect the selected component → load exact schemas → prepare Invocation → authorize and approve → execute through the broker. Full schemas enter context only for components the model has selected, and the compact cards are byte-stable per snapshot so they live in the cacheable prompt prefix (§8b).

## 4. Generic Model Provider Protocol

Elliott does not act as a monolithic model gateway, nor is it coupled to any specific proxy. It defines a provider-neutral `ModelProviderProtocol`. Consumers can install any compliant provider Component (e.g., LiteLLM, Ollama, Anthropic).

**Elliott AgentKernel owns:** Profile intent, data classification and residency policy, residency _enforcement_ (§4a), invocation budgets, prompt construction, tool definitions, tool execution, approvals, and audit records.
**Model Provider owns:** API translation, public model aliases, provider credentials, load balancing/failover, and capability reporting via its catalog.

### 4a. Kernel-enforced residency

The catalog's `locality` field is a self-attested claim by the thing being constrained, and adversary A3 lies. Locality is therefore assigned and enforced by the kernel, not read from the catalog:

- Every provider instance is bound at registration to a **ResidencyGrant**: an egress policy (allowed network destinations, or none) derived from its isolation container's network namespace. A provider with `residency: local` runs with no external egress; the kernel's network policy, not the provider's promise, makes it local.
- The catalog `locality` field is retained for display and cross-checking only. A catalog claiming `local` while holding an external egress grant fails registration (gate G2).
- Requests classified `confidential` or above may only be dispatched to providers whose ResidencyGrant satisfies the classification's residency requirement. The dispatch check reads the grant, never the catalog.

### 4b. Push-based health and catalog currency

Revision 2 consulted `catalog()` and `health()` during resolution, which put provider round-trips ahead of the inference round-trip. Both signals are now push-based state the kernel already holds at resolution time:

- Providers report health through `health.checker` on a kernel-set cadence, and the kernel probes on transport errors. Health transitions update route-table availability flags (§5d) directly; resolution reads the flag, never the provider.
- Catalog changes are detected by `catalogDigest`. A digest change re-runs catalog verification (including the G2 cross-check) and rebuilds affected route tables. A provider whose health reporting lapses beyond the cadence window is marked unhealthy, which is the fail-closed direction: silence removes routes, it never preserves them.

```typescript
export type ModelCapability =
  | "text"
  | "vision"
  | "audio-input"
  | "tool-calling"
  | "parallel-tool-calling"
  | "structured-output"
  | "reasoning"
  | "prompt-caching"
  | "long-context";

export interface ModelCatalogEntry {
  readonly modelId: string;
  readonly capabilities: readonly ModelCapability[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /** Unknown cost is treated as +Infinity by the resolver (§5d), never zero. */
  readonly costPerThousandInputTokensUsd?: number;
  readonly costPerThousandOutputTokensUsd?: number;
  /** Display/cross-check only. Enforcement uses the kernel ResidencyGrant. */
  readonly declaredLocality: "local" | "private-cloud" | "public-cloud";
  readonly available: boolean;
  readonly catalogDigest: Digest;
}

export interface ModelGenerateRequest {
  readonly invocation: InvocationId;
  readonly modelId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly responseSchema?: JsonSchema;
  readonly reasoningEffort?: "none" | "low" | "medium" | "high";
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ModelProviderProtocol {
  catalog(): Promise<readonly ModelCatalogEntry[]>;
  generate(request: ModelGenerateRequest): AsyncIterable<ModelStreamEvent>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  health(): Promise<HealthStatus>;
}
```

## 5. Orthogonal Routing: Profiles, Privacy, and Economics

Routing is decoupled into three independent axes:

1. **Cognitive Complexity (The Profile):** The intelligence and latency required (`fast`, `balanced`, `deep`).
2. **Data Classification (The Privacy Constraint):** Where data is allowed to travel (`public`, `internal`, `confidential`, `restricted`).
3. **Economics (The Measure):** Context window requirements and cost metrics.

### 5a. Reserved Profiles (Cognitive Complexity)

Profiles are stable semantic contracts regarding latency and reasoning capacity.

| Profile      | Description                                                                       |
| :----------- | :-------------------------------------------------------------------------------- |
| **fast**     | Low-latency inference for routine operations, simple extraction, and formatting.  |
| **balanced** | Default general agent profile, balancing reasoning capability, latency, and cost. |
| **deep**     | Highest available reasoning quality for complex planning and heavy tool usage.    |

**Profile ordering is capability-only.** For ceiling enforcement, `fast < balanced < deep` orders _reasoning capability and cost exposure_, not desirability; latency is not monotonic along this order and never participates in ceiling checks. `maximumProfile: balanced` means "may not spend at deep-tier capability/cost," and never blocks a request for `fast`.

**Custom profiles are namespaced.** Non-reserved profiles must use the `custom:` namespace (`ModelProfileId = "fast" | "balanced" | "deep" | \`custom:${string}\``), so a config typo cannot silently mint a new reserved-looking profile. System profiles such as the sanitizer's `audit-local` live in this namespace and are org-pinnable. Custom profiles participate in ceiling checks only where policy explicitly orders them against the reserved three; unordered custom profiles are ceiling-incomparable and require their own explicit grants.

### 5b. The Model Task Request

An Agent or Component expresses its task requirements across these axes, including worst-case budget guardrails:

```typescript
interface ModelTask {
  readonly profile: "fast" | "balanced" | "deep";
  /** Advisory floor only. The kernel dispatches at
   *  max(declared, frame high-water mark); see §5d step 3. */
  readonly declaredClassification:
    | "public"
    | "internal"
    | "confidential"
    | "restricted";
  readonly operation: "chat" | "embedding" | "speech-to-text";
  readonly requires: readonly ModelCapability[];
  readonly maxCostUsd?: number;
}
```

### 5c. Model Profile Bindings

Operators configure multiple prioritized routes per profile, mapping physical deployments to logical profiles alongside priority weights and max expected cost metrics.

```yaml
# .elliott/models.yaml
apiVersion: elliott/v1
kind: config
providers:
  litellm:
    ref: builtin/model-provider/litellm
    config: { baseUrl: "http://litellm:4000" }
    # residency is granted by the kernel at registration, not declared here
  ollama:
    ref: builtin/model-provider/ollama
    config: { baseUrl: "http://localhost:11434" }

profiles:
  fast:
    routes:
      - provider: ollama
        model: llama3:8b
        priority: 1
        costMetric: 0.00
      - provider: litellm
        model: gpt-4o-mini
        priority: 2
        costMetric: 0.15
  deep:
    routes:
      - provider: ollama
        model: command-r-plus:104b
        priority: 1
        costMetric: 0.00
      - provider: litellm
        model: claude-3-5-sonnet
        priority: 2
        costMetric: 3.00
```

### 5d. Model Resolution: precomputed route tables, thin dispatch

The seven filters of Revision 2 remain the semantic definition of resolution. Their inputs split into two groups with different change rates, and the doctrine (§0d) assigns them different homes:

**Table build (event time).** Filters over profile bindings, profile ceilings, ResidencyGrants, required capabilities, catalog capability sets, and health flags depend only on configuration, policy, catalog digests, and health state. On any of those events (config activation, epoch bump, catalog digest change, health transition, ResidencyGrant change) the kernel rebuilds a **route table**: for each key `(profile, effective classification, required-capability set)`, a pre-filtered, pre-sorted candidate list, ordered by `priority` ascending with `costMetric` ties broken low-first, each entry carrying its catalog digest and ResidencyGrant reference. Capability sets are interned; in practice the distinct key count is small. Each table carries the epoch vector and digests it was built from.

**Dispatch (per invocation).** The per-inference path is:

1. **Requested Profile and Ceiling:** as before (capability-only ordering, §5a).
2. **Effective Classification:** compute `effective = max(task.declaredClassification, frame high-water mark)`. The declared value can raise the bar; it can never lower it. A declaration below the frame mark is recorded in the selection record as an under-declaration signal for audit.
3. **Table lookup:** fetch the candidate list for `(profile, effective, requires)`, verifying the table's epoch vector and digests are current. A stale table forces a synchronous rebuild of that key on this call (never a fallback to a stale list).
4. **Budget check:** compute estimated max cost as `maxInputTokens-bounded prompt size × input rate + maxOutputTokens × output rate`; unknown rates estimate `+Infinity`. Drop candidates exceeding `maxCostUsd`. This is the only per-request filter, because prompt size and budget are per-request inputs.
5. **Emit** an immutable `ModelSelectionRecord` referencing the table version, so G11's per-step pruning report is reconstructable from the table-build log plus the budget step.

**Empty candidate set fails closed, identically.** An empty table entry, or a budget step that empties the list, raises `NoEligibleRouteError` carrying the step that emptied the set and the last surviving candidates (for table-time pruning, drawn from the table-build record). The kernel never relaxes a filter to recover, and in particular never widens residency: a `confidential` request whose local route is unhealthy fails at table level the moment the health transition rebuilds the table; it does not fall through to public cloud. The error surfaces to the agent as a typed disposition and to the operator via health telemetry (gate G9). Table/live-filter agreement is conformance-tested (gate G18).

### 5e. Model use policy and governed escalation

Agents map internal activities to profiles declaratively, and the kernel, not the agent, authorizes any deviation:

```yaml
models:
  default: balanced
  uses:
    intent-classification: fast
    skill-selection: fast
    quick-reply: fast
    main-turn: balanced
    planning: deep
    compaction: fast
    reflection: deep
    proposal-authoring: deep
    evaluation: deep
  maximumProfile:
    main-session: deep
    shared-channel: balanced
    child-agent: balanced
  escalation:
    enabled: true
    requireRecord: true
    chains:
      fast: [balanced, deep]
      balanced: [deep]
```

Rules:

1. A skill may request minimum model capabilities (§5b `requires`) but never a provider-specific model.
2. Agents may request escalation along a configured chain; the kernel authorizes it against the ceiling and emits a Record. `model.use.deep` may be configured as a restricted capability requiring a deferred grant (§1).
3. Child agents inherit a maximum-profile ceiling they cannot widen (composition algebra, §1).
4. Profile changes and escalations create explicit Records; downgrades are never silent and carry a reason (`no-route`, `budget`, `ceiling`).
5. Requests whose effective classification requires residency the eligible routes cannot satisfy fail closed (§5d, G9); the use-policy layer never provides a fallback around residency.
6. Model recommendations ("this needs a stronger model") are evidence for an escalation request, never authorization.

The `uses` map feeds table lookups directly: an activity name resolves to a profile before dispatch, so per-activity routing costs nothing beyond the §5d path.

## 6. Information Flow Control (IFC) via Hierarchical Context Stacks

To prevent "security-tag explosion," where reading a single `restricted` item permanently locks an invocation into local-only models for all subsequent generic tasks, Elliott uses a **Hierarchical Context Stack**.

Data classifications are strictly ordered: `public < internal < confidential < restricted`

The active posture (§0e) selects how much of this lattice exists. Under `standard` the lattice is the single level `internal` and everything below runs vacuously at near-zero cost; the mechanics are specified once, at full width, and postures narrow the lattice, not the code.

### 6a. Classification provenance: the kernel sets the mark, not the agent

The agent is untrusted (adversaries A2, A4). If the agent chose frame classifications, it could do restricted work in an under-classified frame and the entire stack would be decorative. Rules:

- Every data source (tool, resource, memory record, message channel) carries a kernel-known classification, assigned from the source component's manifest and policy, not from content inspection alone.
- A frame's classification is the **maximum of the classifications of all data wired into it**, computed by the ContextManager as data arrives. Reading a `restricted` memory record into an `internal` frame raises that frame to `restricted` at the moment of the read.
- Agents may _request_ forks and may request a target classification, but a fork request below the classification of the data the agent intends to route into it simply gets raised when the data arrives. There is no agent-writable path that lowers a mark; lowering happens only through the sanitizer pipeline (§7).

```typescript
export type FrameId = string & { readonly __brand: unique symbol };

export interface ContextFrame {
  readonly id: FrameId;
  readonly parentId?: FrameId;
  /** Kernel-maintained high-water mark. Monotonically non-decreasing for the
   *  frame's lifetime; only a sanitizer merge produces lower-classified data,
   *  and it produces it in the *target* frame, never by lowering the source. */
  readonly classification: DataClassification;
  readonly messages: readonly ModelMessage[];
  readonly securityTags: readonly SecurityTag[];
  /** Monotonic version for optimistic concurrency (§6c). */
  readonly revision: number;
}

export interface ContextManager {
  readonly activeFrame: FrameId;
  fork(requestedClassification: DataClassification, reason: string): FrameId;
  merge(request: MergeRequest): Promise<MergeTicket>;
}

export interface MergeRequest {
  readonly sourceFrame: FrameId;
  readonly sourceRevision: number;
  readonly targetFrame: FrameId;
  readonly rawOutput: string;
  readonly sanitizerComponent: ComponentRef;
  /** Declared by the requester, verified by the kernel against the sanitizer
   *  schema class. Commutative merges may be queued (§6c). */
  readonly ordering: "commutative" | "revision-dependent";
}

/** Merges are asynchronous (§6e). The ticket resolves to a typed disposition. */
export interface MergeTicket {
  readonly mergeId: MergeId;
  readonly result: Promise<MergeResult>;
}
```

Data flows freely down the stack (into more restricted frames). Moving data upward requires the sanitizer pipeline.

### 6b. Memory carries classification across sessions

Persistence is the classic laundering channel: write security-tagged data in a restricted frame today, read it back into a public frame tomorrow. Closed as follows:

- Every memory record written through `memory.writer` is stamped with the writing frame's classification at write time. The stamp is part of the record's identity and digest; a memory provider that drops or alters stamps fails gate G7.
- `memory.reader` returns the stamp with the record, and the ContextManager raises the reading frame's high-water mark to the stamp, exactly as for a live tool result.
- Declassifying stored data means running the stored record through the sanitizer pipeline and writing a _new_ record with the lower stamp and a provenance link to the original. Stamps on existing records are immutable. Because sanitizer decisions are digest-keyed (§7a), repeated declassification of the same stored record under the same policy is a cache hit.
- Classification-taxonomy migrations (adding a level, renaming) are control-plane Proposals (§11c) with an explicit mapping table; records with unmappable stamps become `restricted` by default.

### 6c. Concurrency: serialize application, not judgment

Frames support concurrent child forks. Revision 2 serialized entire merges per target frame, which put sanitizer latency (including Layer-2 TLE inference) inside the critical section and made the parent frame a contention point under the common fork-N/merge-N pattern. The pipeline now has three stages:

**Stage 1 — Sanitize (concurrent).** Sanitization runs outside any frame lock, in parallel across pending merges. A sanitizer decision binds to `(source content digest at sourceRevision, proposed output digest, policy digests)`; it is a judgment about specific bytes, so concurrency cannot change its meaning.

**Stage 2 — Validate ordering (per target, cheap).** For `revision-dependent` merges, the kernel checks `sourceRevision` against the source frame's current revision; a superseded revision rejects with `StaleMergeError` and must be re-requested against current content, exactly as before. For `commutative` merges, the revision check is skipped and the merge queues. Commutativity is not taken on the requester's word: the kernel accepts the `commutative` marking only for merges whose sanitizer path is a Layer-1 schema in the policy's _append-safe_ class (statuses, counts, IDs, enum results, and other order-independent facts, designated per schema at Proposal time). A `commutative` claim on any other path is downgraded to `revision-dependent`.

**Stage 3 — Apply (serialized, constant-time).** Application of an already-approved `SyntheticToolResult` to the target frame is the only serialized step. Merges into the same target apply in kernel-arrival order at this stage; each sees the previous merge's output in the target. The serialized section now contains no I/O and no model calls.

**Hierarchical merge trees.** For wide fan-outs, children may merge into intermediate frames _at the same classification_ in parallel; same-level and downward flow needs no sanitizer, so these merges are Stage-3-only. One sanitized merge then crosses the classification boundary carrying the combined result. This cuts sanitizer invocations from N to 1 for an N-way fan-out and relieves pressure on the per-frame merge rate limits of §6d, which stay at their Revision 2 values rather than being raised to accommodate fan-out.

### 6d. Residual covert channels

Payload inspection cannot see a bit encoded in _behavior_. A restricted-frame agent leaks through: merge/no-merge decisions, choice of tool, call timing, and output length. Mitigations reduce bandwidth without eliminating it: merge requests and cross-boundary tool calls are rate-limited per frame; sanitizer rejections return an opaque error to the requesting frame (the detailed `violationReason` goes to the audit log and operator view only, never back into the frame that attempted the merge, since a detailed rejection is an oracle for iterating attacks); and per-frame egress decision counts appear in audit telemetry so exfiltration-by-thousand-queries shows up as an anomaly. The design accepts low-bandwidth control-flow leakage as a residual risk (§0b) rather than claiming it away. Asynchronous merge completion (§6e) does not widen the oracle: pending and rejected merges resolve through the same opaque, constant-shaped disposition, and cached sanitizer decisions (§7a) are served with response-shape parity so a cache hit is not distinguishable from the source frame's side.

### 6e. Asynchronous merges

Nothing in the declassification design requires the requesting agent to block; only the target frame must never see unsanitized data. `merge()` therefore returns a `MergeTicket` immediately, and the agent continues working in its source frame while Stage 1 runs. The ticket resolves to a typed disposition (§11a): `merged`, `blocked-declassification`, or `stale-merge`. Agents that need synchronous semantics simply await the ticket. Human-review merges (Layer 3, §7) are the main beneficiaries: an operator approval that takes minutes no longer stalls the source frame's unrelated work.

## 7. Declassification: Deterministic Sanitizers First, TLE as a Second Gate

Under the `standard` posture (§0e) no upward classification boundary exists, this pipeline is never invoked, and the TLE is not installed; the section below specifies behavior under `hardened` and `regulated`, and activates structurally unchanged when an operator widens the lattice.

An Agent cannot declassify its own context via prompt output. Revision 1 made a Trusted Local Evaluator (an LLM) the sole declassification boundary. That inverted the trust-capability relationship: the least capable model in the system guarded the highest-stakes decision, against inputs (restricted data) that are precisely the most likely to contain injection attacks aimed at the guard itself (adversary A2). An LLM confidence score is not a calibrated probability, so "auto-approve above 90%" was a threshold an attacker searches for, not a safety margin.

Declassification is a pipeline in which no LLM is ever the _only_ gate:

**Layer 1 — Deterministic sanitizers (primary path).** Structured extraction against an allowlisted output schema (e.g., "return only a boolean," "return only fields {status, count}"), template-constrained redaction, and format validators. Output that conforms to a pre-approved schema whose fields are individually classified below the boundary passes without any model judgment. Most legitimate merges (tool status, counts, IDs, enum results) should be designed to fit this path.

**Layer 2 — Trusted Local Evaluator (advisory gate for free-text).** For outputs that cannot be schema-constrained, the TLE runs on the `audit-local` profile on local hardware and performs differential analysis of source versus proposed output against the DLP policy set. Its verdict is one input to the decision, never the decision:

- TLE **reject** → merge blocked, regardless of anything else.
- TLE **approve** → merge still requires either (a) the output to pass a Layer-1 structural constraint, or (b) human operator approval. There is no fully automatic free-text declassification of `restricted` data.
- Differential analysis is acknowledged as blind to _derived_ data: a paraphrase, aggregate, or inference ("the answer rounds to the CEO's salary") shares no bytes with the source. This is why Layer 2 alone can never approve, and why Layer-1 schemas are the design's center of gravity.

**Layer 3 — Human review.** Operator approval presents the actual sanitized content with a source/output diff, not a digest. Approving a hash is rubber-stamping; the release digest is recorded _after_ the operator has seen the content, to bind the approval to specific bytes.

### 7a. Sanitizer throughput engineering

The TLE runs on local hardware by construction and is the throughput ceiling for free-text declassification. Four measures, none of which change a verdict:

**Digest-keyed decision caching.** Every Layer-1 and Layer-2 outcome is cached under the key `(source content digest, proposed output digest, policy set digest, schema digest, sanitizer component digest)`. Identical inputs under identical policy return the cached decision; the key covers every input to the judgment, satisfying doctrine §0d clause (a). Any sanitizer-policy or schema change is a §11c Proposal, which changes the policy/schema digest and therefore the key; nothing needs explicit eviction. Retried merges and repeated declassification of the same stored memory record (§6b) become cache hits. Layer-3 human approvals are **never** cached: an operator approval binds one operator to one presentation of specific bytes at a specific time, and replaying it would convert a judgment into a rule. If a recurring free-text merge keeps reaching Layer 3, the correct response is authoring a Layer-1 schema for it through a Proposal, not caching the human.

**Compiled Layer-1 validators.** Pre-approved schemas are known at Proposal-activation time. The kernel compiles them to validator functions at activation (ajv-style), keyed by schema digest, instead of interpreting JSON Schema per merge. Compilation failures fail the Proposal, not the merge path.

**Batched TLE calls.** Differential analyses of _independent_ merge candidates (distinct source frames, no shared pending state) may be batched into one local inference where the model supports it. Each candidate receives its own verdict record; a batch is a transport optimization, never a joint judgment, and a malformed batch response fails every candidate in it closed.

**Layer-2 fall-through as a design metric.** The kernel counts, per sanitizer schema class and per component, how many merges fall through Layer 1 to Layer 2 or Layer 3. This metric appears in operator telemetry and in the registry's review tooling next to the capability usage delta (§1). A rising fall-through rate is treated as a design smell prompting new Layer-1 schemas; it moves traffic to the path that is at once the fastest and the strongest.

```typescript
export interface TrustedEvaluatorConfig {
  readonly requireResidency: "local";
  readonly targetProfile: "audit-local";
  readonly activePolicies: readonly string[];
  /** "reject-silently" removed: silent denial in a security path masks both
   *  attacks and bugs, and contradicted the audit posture of G11/G15. */
  readonly fallbackAction: "escalate-to-human" | "reject-and-audit";
}

export interface SanitizerDecision {
  readonly isApproved: boolean;
  readonly approvedVia: "schema" | "schema+tle" | "human";
  /** Whether this decision was served from the digest-keyed cache (§7a).
   *  Audit-visible only; response shape toward the source frame is identical
   *  for hits and misses (§6d). */
  readonly servedFromCache: boolean;
  readonly sanitizedOutput?: string;
  /** Audit log and operator view only. Never returned to the source frame. */
  readonly violationReason?: string;
  /** Advisory telemetry. Never compared against a threshold to auto-approve. */
  readonly tleConfidence?: number;
}

export interface SanitizerProtocol {
  sanitize(request: SanitizeRequest): Promise<SanitizerDecision>;
}
```

Approved merges produce a `SyntheticToolResult` in the target frame carrying the sanitized output, the `approvedVia` path, and provenance links. Every sanitizer decision, approved or rejected, cached or fresh, is an audit record (gate G15). Cache-key coverage is conformance-tested (gate G19).

## 8. Broker, Provider Integrity, and Execution Boundaries

- **Avoid Splitting Routing Responsibility:** Elliott selects the profile and route. The Provider (e.g., LiteLLM) is solely responsible for executing that specific alias and handling upstream load-balancing.
- **Do not delegate tools or MCP execution to Providers:** All tool calls, Web Search, Computer Use, or code execution must return to the Elliott AgentKernel capability broker to enforce GrantSets, approval protocols, and IFC rules.
- **Outbound Argument Inspection:** Every tool execution leaving the local boundary, including query parameters, headers, and URL parameters for generic requests, is inspected against the effective classification of the active frame. Inspection is incremental per §8a.

### 8a. Incremental inspection of streamed tool calls

The invariant stands verbatim: for streamed generations, tool-call arguments are buffered until the argument block is complete, and partial tool-call deltas never trigger side effects. What overlaps with arrival is analysis, not effect:

- The classification/DLP scanner runs incrementally over argument deltas as they stream, carrying scanner state across chunks, so the verdict is rendered the moment the block completes instead of starting then.
- The broker performs side-effect-free preparation speculatively while the block streams: connection setup, auth token fetch, and the capability check via the epoch-checked grant cache (§1a). Preparation that is not observably side-effect-free (anything that writes, sends, or reserves external state) is not eligible for speculation.
- On a negative verdict, speculative preparation is discarded; nothing external observed the attempt beyond the connection primitives the broker owns.

### 8b. Prompt-Cache Stability, Residency, and Economics

Keep constitution, interaction profiles, and tool descriptors byte-stable. Profile or model route changes explicitly fork the cache identity. **Caching is a residency event:** a provider-side prompt cache is data at rest at the provider, so the `prompt-caching` capability may only be exercised on a route whose ResidencyGrant satisfies the effective classification of the cached prefix.

The Revision 2 rule ("`confidential+` frames on non-local routes set no-store for the request") charged the full cache penalty to exactly the long contexts that benefit most. The rule is now applied per prefix segment rather than per request:

- **Classification-split prefix structure.** The kernel constructs prompts so that kernel-owned stable content (constitution, tool descriptors, interaction profiles), which is `public`/`internal` by construction, sits ahead of an explicit cache breakpoint. Frame content follows the breakpoint. On a non-local route, a `confidential+` request caches the prefix up to the breakpoint and sets no-store for everything after it. The residency invariant holds for every cached byte (G13); only bytes whose classification the ResidencyGrant satisfies are ever cached.
- **Route stickiness.** Within a session, dispatch prefers the previously used route among candidates that are tied under §5d ordering, so priority/cost tie-breaking does not flap between equivalent routes and destroy warm caches. Stickiness never overrides ordering, filtering, or fail-closed behavior; it only breaks exact ties, and a health transition or epoch bump clears it with the route table.
- **Kernel-side prefix cache for local routes.** For providers whose ResidencyGrant is local, at-rest prefix storage is inside the boundary already; the kernel may maintain its own prefix cache keyed by prefix digest and route identity to give cache economics to local models that lack native prompt caching.

### 8c. Secrets

Secrets are opaque references, never values:

```yaml
token: secret://gateways/slack/bot-token
```

A secret policy binds: the intended component principal, the destination or audience, the allowed operation, expiration, rotation policy, and injection mechanism. The preferred injection mechanism is **broker-performed authenticated requests**, where the component never receives the raw value at all; where a wire client must hold the credential (§14b companions, gateway containers), the value mounts as a runtime secret into exactly that container. Secret values never enter model context, frames, manifests, environment blocks of model-visible components, or audit record payloads (records reference the secret URI, never the value), and the §8a scanner fails closed any outbound argument matching a registered secret (G23).

### 8d. Approvals

An approval request binds, immutably: invocation ID, target component, protocol and operation, canonical input, input digest, schema digest, requested capabilities, prepared-plan digest, and expiration. Decisions are typed:

```text
allow-once | deny-once | allow-session | propose-policy
```

`allow-session` is scoped to the session and dies with it. A durable policy rule is always a separate §11c Proposal (`propose-policy` opens one); it is never an implicit side effect of clicking approve, because standing authority created in an approval dialog is authority nobody reviews. Approval presentation follows the Layer-3 rule of §7: the operator sees canonical content, and the recorded digest binds to the bytes shown. Deferred-grant activations (§1) and Layer-3 declassifications are approval requests of this same shape.

## 9. Component Manifests & Agent Skills Compatibility

Agent Skills remain natively portable through unmodified `SKILL.md` files. Elliott uses a strict security overlay (`manifest.yaml`) for authority.

- A pure Agent Skill needs only `SKILL.md`.
- A missing `manifest.yaml` means zero executable authority.
- `allowed-tools` in SKILL.md remains an interoperability hint, not an Elliott grant.
- Files under `scripts/` are inert unless explicitly exported; every executable export has runtime input/output schemas and declares capability requests.
- Project skills require a workspace trust decision; skill text cannot set prompt precedence.
- **Markdown and YAML hardening (no angle-bracket stripping):** stripping angle brackets mutates source bytes and is not an injection defense. Instead: reject duplicate YAML keys; disable custom YAML tags; bound alias expansion, nesting depth, scalar size, and total file size; preserve raw bytes for digests and signatures; treat descriptions and Markdown as untrusted content (adversary A1: manifest text reaches model context); escape according to destination format; never derive authority from natural-language fields; keep prompt precedence fixed by the kernel; enforce path containment and reject escaping symlinks; strict validation for security overlays, controlled compatibility parsing for third-party `SKILL.md`.

### 9a. Authoring defaults: one line to authority, zero lines to none

The overlay model already gives the easiest possible entry point (a pure `SKILL.md` runs with zero executable authority). The gap Revision 4 closes is the next step up, where Revision 2–3 required authors to enumerate capabilities by hand, which produces either frustration or copy-pasted over-requests (the exact A1 pressure §1 warns about).

**Capability templates.** `manifest.yaml` may declare a `profile` that expands to a kernel-vetted, versioned capability set:

```yaml
# manifest.yaml — the whole file, for most tools
profile: tool-standard # read own package dir, tmp scratch, brokered fetch to declared hosts
```

Built-in templates ship for the common shapes: `tool-standard`, `tool-local-only` (no network capability at all), `resource-reader`, `prompt-source-zero-authority`. A template expands at validation time into ordinary `requestedCapabilities`, so everything downstream (intersection, usage delta, `grants.explain`, review tooling) sees concrete capabilities and the template is pure authoring sugar. Authors add or remove individual capabilities alongside the template; removals always win. Template definitions are org-pinnable, and template _version_ is part of the manifest digest, so a template change cannot silently widen an already-reviewed component.

**Scaffolding.** `elliott new skill` / `elliott new tool` emits `SKILL.md`, a minimal `manifest.yaml` on `tool-standard`, and a conformance test stub that exercises G1/G3 locally before publication.

**Dev mode is a UX mode, not a security mode.** A workspace flagged `dev: true` changes nothing in any intersection or floor. It changes feedback: deferred-grant JIT prompts auto-surface inline instead of queuing, every capability denial prints its `grants.explain` output, and the usage-delta report runs on every reload instead of per release. The correct authoring loop is fast _visibility_ into denials, not fewer denials.

### 9b. Example skill overlay

The strict overlay for a skill that exports one executable, restored from Revision 1 and updated to the current manifest schema (§2) and template system (§9a):

```yaml
# manifest.yaml
apiVersion: elliott/v1
kind: skill
profile: tool-local-only # template: no network capability at all

exports:
  - ref: tool/read-staged-diff
    implementation: scripts/read-staged-diff.ts
    inputSchema: schemas/read-staged-diff.input.json
    outputSchema: schemas/read-staged-diff.output.json

capabilities:
  request:
    - capability: process.execute
      resources: ["executable://git"]
      constraints:
        args: ["diff", "--cached"]
```

The accompanying `SKILL.md` stays fully portable to any Agent-Skills host; only Elliott reads the overlay. With no overlay, the same skill loads with zero executable authority.

## 10. Agent Composition vs Interaction Profiles

The `InteractionProfile` (voice/style/tone) is explicitly decoupled from the `Agent` (authority/models/skills/policy). An InteractionProfile is a zero-authority PromptSource: it controls presentation, never authorization, and policy always overrides it.

**AgentTopology.** Multi-agent composition and routing (Revision 1's "Fleet") is its own component kind implementing `composition.members`: which agents exist, how inbound sessions route among them, and delegation relationships. Membership transfers no authority (§1); a child agent's effective ceiling is `parent ceiling ∩ child requests ∩ child policy`, and a topology cannot widen any member beyond what each member's own policy allows.

### 10a. Prompt architecture

Prompt segments are typed rather than concatenated blindly:

```typescript
export interface PromptSegment {
  readonly purpose:
    | "constitution"
    | "runtime"
    | "operator"
    | "workspace"
    | "interaction-profile"
    | "task"
    | "skill"
    | "memory"
    | "evidence";
  readonly source: string;
  readonly digest: Digest;
  readonly trust:
    | "system"
    | "operator"
    | "authenticated"
    | "external"
    | "untrusted";
  readonly securityTags: readonly SecurityTag[];
  readonly content: string;
}
```

Semantic order: constitution → generated runtime identity → operator and workspace instructions → interaction profile → current task → activated skills → retrieved memory → external evidence and tool results. This order is also the cache-stability order: everything through activated skills is byte-stable per snapshot and sits ahead of the §8b cache breakpoint.

Rules: policy overrides the interaction profile; user intent controls the task; the interaction profile controls presentation, not authorization; skills provide procedure, not authority; memory provides context, not authority; evidence never gains instruction precedence; secrets never enter prompt context. Segment `trust` and `securityTags` feed the frame high-water mark (§6a) exactly as tool results do.

## 11. Orchestration, Learning, and Configuration

### 11a. Typed Dispositions

Replace magic sentinel strings (`NO_REPLY`, `HEARTBEAT_OK`) with typed dispositions; gateway adapters may translate these into external sentinel conventions where a platform requires them, but the internal protocol is the union:

```typescript
export type TurnDisposition =
  | { readonly type: "respond"; readonly message: OutboundEnvelope }
  | {
      readonly type: "silent";
      readonly reason:
        | "no-user-visible-result"
        | "duplicate"
        | "policy"
        | "heartbeat";
    }
  | { readonly type: "heartbeat-ok"; readonly checkedAt: IsoDateTime }
  | { readonly type: "blocked-no-route"; readonly error: NoEligibleRouteError } // §5d
  | { readonly type: "blocked-declassification" } // §7, opaque per §6d
  | { readonly type: "stale-merge" } // §6c
  | { readonly type: "merged"; readonly result: SyntheticToolResult }; // §6e
```

### 11b. Transactional Configuration Activation

Replace rollback concepts with immutable candidate revisions (`active revision A → create candidate B → evaluate security delta → start instances → health check → atomically activate B`). Activation bumps every epoch whose policy sources revision B touches, which simultaneously: revokes A-derived grants on the next brokered call without instance restarts (§1a), invalidates affected route tables (§5d), forces re-placement of cohabiting instances whose contexts diverged (§2b), and rotates sanitizer cache keys where policy digests changed (§7a). One activation event, one invalidation mechanism.

### 11c. Proposal-Based Learning

Managed through a strict policy pipeline: `SignalDetector → ProposalAuthor → EvaluationPlan → Evaluators → HumanReview → DeploymentManager`. Classification-taxonomy changes, sanitizer policy changes, Layer-1 schema additions (including append-safe class designations, §6c), and compiled-validator activation route through this pipeline exclusively.

**Separated authorities.** No single runtime holds the whole loop: `SignalDetector`, `ProposalAuthor`, `Evaluator`, `HumanApprover`, and `ReleasePromoter` are distinct principals, and the author of a change can never approve or promote it alone (invariant 10, §0f). The hermes-style skill curator (§14d) holds only SignalDetector and ProposalAuthor authority.

**Signal ranking.** Signals rank: (1) explicit user correction, (2) explicit user-confirmed success/failure, (3) deterministic evaluator result, (4) repeated successful workaround, (5) repeated tool or routing failure, (6) model self-reflection. Self-reflection alone can never authorize promotion.

**Proposal storage.** A Proposal is a directory, not a database row, so it is diffable, signable, and reviewable with ordinary tools:

```text
proposals/prp_01J.../
├── proposal.yaml        # metadata, target ref, target digest binding
├── PROPOSAL.md          # human-readable rationale
├── target.yaml          # resolved target descriptor
├── patch.diff
├── evidence.yaml        # ranked signals backing the change
├── permission-diff.yaml # capability delta, surfaced first in review
├── eval-plan.yaml
└── support/
```

A Proposal binds to the active target digest; if the target changes underneath it, the Proposal is stale and must be re-authored, never auto-rebased.

**Evaluation stages, in order:** YAML validation → Markdown validation → manifest schema validation → path containment → permission-delta analysis → static security analysis → unit and contract tests → clean-context evaluation → with-versus-without (or previous-version) comparison → adversarial injection tests → cost and latency comparison → canary execution.

**Promotion** is the atomic control-plane transaction of §11b: revalidate target digest, rerun required tests, write rollback metadata, write the new revision, update the lockfile, compute a new Snapshot, start canary instances, then promote or roll back. Historical Records and release digests are immutable; active artifacts may be retired, and physical deletion follows explicit retention and privacy policy.

### 11d. Footprint Budgets and Compaction Gates

Three footprints are measured and attributed separately, with regression gates in CI:

- **Prompt footprint:** stable prefix tokens, skill-catalog tokens, activated-skill tokens, tool-schema tokens, evidence tokens. Compact capability discovery (§3b) is the primary lever.
- **Inference footprint:** input tokens, cached input tokens, output tokens, cost, and latency per activity (§5e `uses` map gives the attribution key).
- **Runtime footprint:** pool container count and residency, memory per security context, epoch-table and route-table sizes.

**Tool-pair-safe compaction** generalizes transcript compaction to causal blocks preserved atomically: an assistant tool call + its approval decision + the matching tool result + retry/failure metadata compact together or not at all. The transcript is a projection of durable Records, never the sole source of runtime truth. A silent or proactive turn may flush durable notes before compaction, but as an explicit memory operation under policy (§14d `on_pre_compress`), not a hidden prompt convention. Compaction summaries inherit the classification of the frame they summarize; compaction is never a declassification path.

## 12. Runtime, Packaging, and Repository Structure

**Package Contract:** Standards-based ESM, Node.js >=22, using `new URL(".", import.meta.url)` for path resolution. Cross-boundary process/container components use the wire/framing transports of §2 over multiplexed streams.

### 12a. Audit log architecture

G11 + G15 + G16 previously implied one global hash chain with an inline fsync per record, serializing every security-relevant event in the system behind one write head. The append-only and chain-verifiability guarantees are kept; the synchrony is relaxed only where no gate depends on it.

**Sharded chains with Merkle cross-links.** The log is sharded per scope and per event class (inference selection, sanitizer decisions, registration/epoch events). Each shard is independently hash-chained. On a fixed cadence and at every configuration activation, the kernel writes a **cross-link record**: a Merkle root over all shard heads, appended to a root chain. Verification of the root chain plus shard chains covers the whole log; tampering with any shard breaks its next cross-link.

**Group commit.** Within a shard, records batch into a single fsync. Chain order within the batch is preserved; durability is amortized.

**Durability classes.** Records divide by whether an irreversible external effect depends on them:

- **Effect-gating records** must be durable _before_ the effect executes: a Layer-3 declassification approval before the merge applies, an outbound dispatch record at `confidential+` before the request leaves the boundary, a registration/quarantine event before the resolution outcome is served, an epoch-bump record before the new policy is enforced. These records ride the next group commit and the effect awaits its completion; group commit bounds the added latency to one shared fsync.
- **Observational records** (selection telemetry, health transitions, cache hit/miss counters, usage deltas) ride an ordered bounded queue flushed in batches. A crash may lose the tail of observational records; it can never lose a record that an executed effect depended on, because the effect waited.

The classification of each record type into a durability class is part of the schema for that record type and is itself Proposal-governed. Conformance: gate G20.

### 12b. Container Deployment Profile

The reference deployment is a small set of containers (Docker or compatible OCI runtime). The design already located enforcement at OS boundaries where possible ("the kernel's network policy, not the provider's promise, makes it local," §4a); this section makes the delegation explicit: **where the container runtime enforces an invariant, the kernel verifies rather than re-implements.**

**Deployment units.**

| Container                          | Contents                                                                          | Trust                                                                                                                                                                                |
| :--------------------------------- | :-------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elliott-kernel`                   | AgentKernel, broker, ContextManager, route tables, caches, native hot core (§12c) | TCB                                                                                                                                                                                  |
| `elliott-audit` (optional sidecar) | Append-only audit API over the shard chains; owns the audit volume exclusively    | TCB, but a smaller one: the kernel holds an append-only client credential, so even kernel code outside the audit writer cannot rewrite history without also compromising the sidecar |
| Component pool containers          | Warm sandbox pool (§2b), one security context per container                       | Untrusted                                                                                                                                                                            |
| Provider containers                | One per model provider                                                            | Untrusted (A3)                                                                                                                                                                       |
| `elliott-tle`                      | TLE runtime, `hardened+` postures only                                            | Trusted for its advisory verdict, never solely (§7)                                                                                                                                  |

**What the OS now enforces, and what the kernel stops doing.**

- **Residency = network topology, verified by probe.** A provider's ResidencyGrant is realized as its container's network attachments: a `local` provider attaches only to an internal-only network (`internal: true`; no default route, no DNS egress). The kernel does not run its own egress firewall for residency. It _verifies_: at registration, and on a per-posture cadence, the kernel executes an **egress canary** inside the provider's network namespace attempting to reach an external beacon over each of TCP, UDP, and DNS. Canary success on any channel while the ResidencyGrant claims `local` fails the grant closed, exactly as a lying catalog does under G2. Probes beat configuration trust: a compose file can drift, be overridden, or lie; a packet either leaves or it doesn't. Declared topology diverging from probe results is a registration failure, not a warning. Gate G21.
- **Quantitative limits = cgroups.** CPU, memory, pids, and I/O limits from the GrantSet's resource-limit minimum are compiled into the container's cgroup at placement (§1). The broker keeps token budgets, cost ceilings, and rate limits, which no cgroup can express.
- **Filesystem immutability = read-only mounts.** Package roots, skill directories, policy files, and schema stores mount read-only into the kernel and pool containers; component containers get a read-only rootfs plus a tmpfs scratch. This does not remove the G3 runtime-contract comparison (a package can be malicious without ever changing), but it shrinks the TOCTOU surface the comparison defends and makes the §3a validation cache safe to trust harder: within one mount generation, a digest cannot silently change.
- **Sandbox hardening = runtime profiles.** Component and provider containers run `cap-drop: ALL`, `no-new-privileges`, user namespaces, and a per-component-class seccomp/AppArmor profile shipped with the framework. The Docker control socket is never mounted into any container, including the kernel: topology facts the kernel needs arrive as a static deployment manifest, and G21's probes verify the facts that matter rather than trusting the manifest.

**What collapses.** In a containerized deployment every non-TCB component runs in a container, so the `process` and `container` isolation levels converge on one mechanism and the warm pool (§2b) maintains a single container type per security context. The `IsolationLevel` type is unchanged (bare-metal deployments still distinguish them); the deployment profile simply satisfies both floors with the stronger mechanism at pool cost.

**Honest limits.** A container shares the host kernel; it is not a VM boundary. For `container`-floor components from untrusted authors under `regulated` posture, the deployment profile supports a `runtimeClass` escalation to gVisor or Kata per security context. And the probe verifies _network_ residency only; a provider with legitimate local egress to a sibling container could still misuse it, which is why outbound _argument_ inspection (§8a) stays in the broker: content-level checks cannot be delegated to a packet filter.

### 12c. The Native Hot Core

Most of the kernel is control-plane logic that runs at event time and gains nothing from compilation; TypeScript on Node 22 is the right tool for it, and route lookup, merge application, and resolution are all sub-microsecond in JS once §0d has moved them off the recomputation path. Four computations run per-call or per-byte and are worth native code, collected into one module (`@elliott/hot-core`):

1. **Digesting.** The digest is this design's identity primitive: manifests, configs, catalogs, cache keys, sanitizer keys, stamps, chain links. BLAKE3 via N-API, with incremental hashing so streamed content digests as it arrives. This is the single broadest win because every other mechanism keys on it.
2. **Streaming classification/DLP scanning.** The §8a incremental scanner and Layer-1 pattern components compile their pattern sets to a DFA (RE2-semantics: linear time, no backtracking, so adversarial content cannot cause pathological scan times, which matters because A2 controls the scanned bytes). Pattern-set compilation happens at Proposal activation, keyed by policy digest, mirroring the compiled-validator rule of §7a.
3. **The epoch table.** Epoch counters live in shared memory (SharedArrayBuffer) mapped into broker workers; the §1a fast-path currency check becomes a few atomic loads with no IPC hop. Only the kernel holds the writable mapping; workers hold read-only views, so a compromised worker can at worst read counters it could already infer.
4. **Audit chain append.** Chain-link hashing, Merkle cross-link computation, and group-commit batching (§12a) sit next to the hasher they depend on.

Explicitly not compiled: JSON Schema validators (ajv's generated JS is JIT-compiled already and schema counts are small), route tables, grant intersection (event-time), and anything in the sanitizer above the pattern layer.

**TCB admission rules for native code.** Native code trades memory safety for speed inside the most trusted process, so admission is narrow: the hot core is written in Rust with `unsafe` forbidden outside the N-API boundary crate; it is fuzzed per release against the conformance corpus; its API is data-in/data-out with no authority (it holds no handles, makes no decisions, opens no sockets), so a bug in it corrupts a computation the caller then fails closed on, rather than granting anything. Where a deployment prefers sandboxing over raw throughput, the scanner (item 2) also ships as WASM with identical semantics; items 1, 3, and 4 are N-API-only because their value is precisely the boundary they avoid.

## 13. System Acceptance Gates

**Implementation latitude.** Gates G1–G16 specify observable semantics, not mechanisms. An implementation satisfies them with cached-but-version-checked computation under the doctrine of §0d; nothing in G1–G16 mandates uncached recomputation. Gates G17–G20 then test the caching layer itself. Every gate below is stated so that both a naive recomputing implementation and a doctrine-conformant cached implementation pass or fail identically.

**G1 — Kind Integrity:** Instantiating a Component whose runtime `expectedKind` differs from its manifest kind fails at construction.

**G2 — Residency Grant Consistency:** A provider whose catalog declares `local` while holding an external egress ResidencyGrant fails registration. Dispatch decisions demonstrably read the ResidencyGrant, never `declaredLocality`. Catalog digest changes re-run this check before any rebuilt route table serves a request (§4b).

**G3 — Manifest/Runtime Contract:** Any divergence between static manifest and runtime-reported contract aborts registration, quarantines the package as `unavailable` (never absent), and emits an audit event. Validation-cache hits (§3a) do not skip the instantiation-time runtime-contract comparison; snapshot cold-starts (§2b) with a digest mismatch fall back to full import and comparison.

**G4 — Isolation Floors:** No component instantiates below its schema's `minimumIsolation`. No non-TCB component runs `in-process`. No component observing `confidential+` frames runs below `process` isolation. Cohabitation (§2b) occurs only between identical security contexts, never across a `SecurityCriticalKind` line, and is recorded in placement and audit. Warm-pool exhaustion falls back to cold spawn, never to a weaker isolation level.

**G5 — Org Pinning:** A narrower scope cannot shadow an org-pinned component or any `SecurityCriticalKind` component. Attempted shadowing is a hard resolution error, not a lockfile footnote.

**G6 — Grant Revocation:** Revoking a GrantHandle takes effect on the next brokered call without instance restart; the instance transitions to `draining` and its subsequent brokered calls fail with `GrantRevokedError`. This holds under the epoch-checked cache of §1a: the conformance test revokes between two brokered calls and asserts the second call fails.

**G7 — Memory Classification Round-Trip:** A record written in a `restricted` frame and read in any other session raises the reading frame to `restricted`. A memory provider that returns records without valid stamps fails conformance.

**G8 — Model Profile Completeness:** Every reserved profile (`fast`, `balanced`, `deep`) is explicitly bound or marked unavailable.

**G9 — IFC, Outbound Inspection, and Fail-Closed Routing:** A `restricted` or `confidential` invocation is never rerouted to a route whose ResidencyGrant fails the effective classification, including under route failure: an emptied candidate set (whether emptied at table build or at the budget step) raises `NoEligibleRouteError` rather than relaxing any filter. All outbound tool argument payloads (URLs, headers, query parameters) are checked against the effective frame classification before dispatch; incremental scanning (§8a) renders no verdict and dispatches nothing before the argument block is complete, and speculative preparation performs no externally observable side effect.

**G10 — Capability Drift:** A route lacking required capabilities is rejected before invocation, whether the rejection occurs at table build or dispatch.

**G11 — Model Selection Audit:** Every inference record includes: requested profile, effective profile, declared classification, frame high-water mark, effective classification, under-declaration flag, requested alias, actual provider/model, ResidencyGrant reference, selection reason (per-step pruning reconstructable from the referenced route-table build record plus the dispatch-time budget step), route-table version, profile digest, catalog digest, token usage, latency, and cost.

**G12 — Broker Integrity:** External providers never execute Elliott tools or auto-execute MCP calls. Every returned tool call re-enters the Elliott AgentKernel capability broker.

**G13 — Prompt-Cache Stability and Residency:** Stable prompt prefix bytes do not change between ordinary turns. Profile or model-route changes explicitly change cache identity. No byte whose classification exceeds a route's ResidencyGrant is ever cached on that route; under the split-prefix structure (§8b) this is asserted per segment, and the `confidential+` suffix on a non-local route is verifiably no-store.

**G14 — Profile & Policy Governance:** Model-profile, interaction-profile, sanitizer-policy, classification-taxonomy, Layer-1 schema, and append-safe-class changes are control-plane Proposals. No free-text declassification of `restricted` data occurs without a Layer-1 schema constraint or human approval. Human (Layer-3) approvals are never served from cache.

**G15 — Sanitizer Audit and Oracle Resistance:** Every sanitizer decision (approved or rejected, cached or fresh, with `approvedVia` path and `servedFromCache` flag) is an immutable audit record. `violationReason` never flows back into the source frame. Merge requests are rate-limited per frame, and rejection responses to the frame are opaque and constant-shaped; cached and fresh decisions present identical response shapes to the source frame.

**G16 — Audit Log Integrity:** Audit records (G11, G15, registration and epoch events) are append-only and hash-chained per shard, with Merkle cross-links binding shard heads to a root chain (§12a); the kernel exposes verification of full-log integrity across shards. No component, including `policy` and `evaluator` kinds, holds a capability to modify or delete audit records. (The TCB itself can, by definition, subvert this; see §0b.)

**G17 — Epoch Coherence:** No security decision is served from a cache entry whose epoch vector or input digests are stale. Conformance drives each epoch source (policy edit, revocation, activation, catalog change, ResidencyGrant change, deferred-grant activation) and asserts the immediately following brokered call, dispatch, or placement decision reflects the new state. Cohabiting instances whose security contexts diverge under an epoch bump are re-placed before the next brokered call completes under the new policy. Cache miss, mismatch, and corruption paths fall back to full recomputation with all fail-closed behavior intact.

**G18 — Route-Table Equivalence:** For every `(profile, effective classification, required-capability set)` key, the precomputed candidate list equals the output of running the Revision 2 filter sequence live against current config, grants, catalog, and health state. Conformance fuzzes configurations and health transitions and diffs table contents against the reference filter. A stale table detected at dispatch is rebuilt synchronously on that call, never served.

**G19 — Sanitizer Cache Soundness:** The sanitizer decision cache key covers source content digest, proposed output digest, policy set digest, schema digest, and sanitizer component digest. Conformance mutates each key input independently and asserts a fresh evaluation. No Layer-3 decision is ever cached. Batched TLE evaluation produces per-candidate verdicts identical to sequential evaluation, and a malformed batch response fails all candidates in the batch closed.

**G20 — Audit Durability Ordering:** No irreversible external effect executes before its effect-gating audit record is durable: conformance kills the kernel between record-write and effect for each effect-gating type and asserts on recovery that no effect occurred without its record. Observational-record loss on crash is bounded to the unflushed queue tail. Cross-link verification detects tampering in any shard.

**G21 — Residency Probe & Topology Attestation:** In the container deployment profile, a `local` ResidencyGrant is granted only after an egress canary executed inside the provider's network namespace fails to reach the external beacon on every probed channel (TCP, UDP, DNS), at registration and on the posture's cadence. Canary success revokes the grant and rebuilds affected route tables before the next dispatch. Declared deployment topology diverging from probe results fails registration closed. No container, including the kernel's, has the container-runtime control socket mounted.

**G22 — Posture Monotonicity:** Bookkeeping is posture-independent: under every posture, including `standard`, classification stamps are written on every memory record, frame marks are maintained, ResidencyGrants are recorded and probed, and effect-gating audit records are durable before their effects. Raising the posture is a taxonomy migration (§6b) whose mapping is injective on existing stamps; conformance writes records under `standard`, raises to `regulated`, and asserts that every historical record enforces at its stamped level with no unmarked or laundered path. Lowering the posture never relabels a stamp. Under `standard`, conformance asserts the sanitizer pipeline and TLE are never invoked and that no dispatch is pruned by residency, while the same IFC code paths execute.

**G23 — Companion Containment:** A companion container (§14b) inherits its owner's security context, its lifecycle is bound to the owning instance (no orphan survives owner drain), its egress class never exceeds the owner's effective class, its image digest is covered by the manifest digest, its endpoints are unreachable from any container other than its owner, and `none`-class companions pass the G21 canary. Secrets mount only into the container that dials the wire; conformance asserts no secret value appears in any frame, any model-visible environment, or any outbound argument (the §8a scanner match on registered secret digests fails the dispatch closed).

**G24 — Gateway Ingress Discipline:** Every inbound payload on every bundled gateway is stamped at its route's classification and enters the system as untrusted content; signature/HMAC verification, where the channel defines one, completes before the payload reaches the broker, and unverifiable payloads are dropped with an audit record, never delivered. No sender outside a channel's pairing/allowlist reaches an agent frame. The cloudflared tunnel terminates only at verified webhook-gateway routes.

**G25 — Scheduler Authority Freshness:** A scheduled job stores principal and capability requests, never resolved grants. Conformance schedules a job, revokes its principal (or narrows policy) before fire time, and asserts the run fails closed with a typed disposition and audit record. Every fired job runs in a fresh frame with no inherited context, and concurrent daemon ticks execute a job at most once under the lease.

## 14. Bundled Catalog (First-Party Components)

Everything below is an ordinary Component using the kinds and mechanisms already specified; nothing in this section adds kernel surface beyond §14a and §14b. Each bundled entry ships as: a manifest with a capability template (§9a), an egress class default, posture-conditional behavior where relevant, and a companion declaration where a sidecar is needed. Bundled components are first-party and org-pinnable but are **not** TCB; they run in pool containers like anything else, because "we wrote it" is not an isolation argument (adversary A2 flows through most of them).

### 14a. Egress classes: the network policy vocabulary

Every component's network access is expressed as one **egress class**, ordered as a lattice:

`none < loopback < lan < declared(hosts) < any`

- The effective class is the intersection (lattice-minimum, with `declared` sets intersecting element-wise) of: manifest request ∩ template ∩ workspace policy ∩ org ceiling. This is the existing capability algebra of §1; egress is just a structured capability.
- Realization follows §12b: `none` is an internal-only network attachment verified by egress canary; `loopback` adds no attachment at all; `lan` attaches to a host-bridged network with RFC1918-scoped nftables; `declared` compiles the host list into the container's egress filter, and the broker's argument inspection (§8a) independently checks destination hosts at content level, so a DNS-rebinding or redirect that slips the packet filter still fails the broker check.
- Operators configure per-component overrides in the workspace overlay; the org ceiling caps them. `any` is never a template default for any bundled component; the widest shipped default is `declared`.

### 14b. Companion containers: sidecars that just work

Some extensions are only honest as a dedicated container: a browser is a full Chromium, cloudflared is a daemon, a vector database is a server. The manifest may therefore declare companions, and the placement layer (§2b) owns their lifecycle:

```yaml
# manifest.yaml (excerpt) — browser extension
profile: extension-standard
companions:
  - name: chromium
    image: ghcr.io/elliott/agent-browser@sha256:… # digest-pinned, no floating tags
    egress: declared([]) # ≤ owner's effective class; overridable up to it
    endpoint: cdp # exposed to the OWNING component only, pool network
    volumes: [{ tmpfs: /profile }]
    health: { http: "http://chromium:9222/json/version" }
```

Rules, all enforced by placement and gated by G23:

- A companion **inherits the owning component's security context** (same grant ceiling, same classification exposure) and its lifecycle is bound to the owning instance: open with it, drain with it, die with it. Orphaned companions are reaped.
- A companion's egress class is capped at the owner's effective class; a companion can be narrower, never wider. `none`-class companions are canary-probed like local providers (G21).
- Images are digest-pinned in the manifest and covered by the manifest digest, so a companion image change is a component version change, re-entering review and G3.
- Companion endpoints are reachable only from the owning component's container over the pool network, never from other components and never from the host by default.
- Secrets (API keys, OAuth tokens, tunnel tokens) mount as runtime secrets into the specific container that dials the wire, and only that one. They never appear in environment blocks of model-visible components, never in model context, and never in manifests. The broker holds secret _references_; §8a inspection rejects any outbound argument containing a secret value byte-for-byte (the scanner's pattern set includes registered secret digests over normalized encodings).

This is the "more complicated config that just works" mechanism, and it is deliberately generic: the browser, cloudflared, stdio MCP servers, the TLE, and memory databases all ride it. **So yes: the browser lives in a separate container**, and the reason is A2 at maximum concentration: a browser executes adversarial JavaScript from arbitrary origins as its job description. It gets its own container, its own egress class, a tmpfs profile wiped per session, and everything it returns (page text, screenshots, downloads) re-enters the broker as untrusted content stamped at the channel's classification.

### 14c. Catalog entries and their nonobvious wiring

| Component                | Kind / protocols                              | Default egress                            | The part worth stating                                                                                                                                                                                                                                                                                                                                                                    |
| :----------------------- | :-------------------------------------------- | :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-duckduckgo`      | tool: `search.provider`                       | declared(ddg)                             | No key; the zero-config default so search works out of the box.                                                                                                                                                                                                                                                                                                                           |
| `search-brave`           | tool: `search.provider`                       | declared(brave API)                       | Key via secret mount.                                                                                                                                                                                                                                                                                                                                                                     |
| `web-firecrawl`          | tool: `search.provider`, `content.extractor`  | declared(firecrawl API)                   | Extraction strips active content and normalizes to text/markdown before broker re-entry.                                                                                                                                                                                                                                                                                                  |
| `web-parallel`           | tool: `search.provider`, `content.extractor`  | declared(parallel API)                    | Same extractor contract; providers are interchangeable behind the two protocols, mirroring hermes-agent's pluggable web-provider layout.                                                                                                                                                                                                                                                  |
| `browser`                | extension: `tool.executor` + companion (§14b) | declared([]) grows per-task               | Operator or task grants per-origin host additions at runtime as deferred grants (§1); CDP never exposed beyond the owner.                                                                                                                                                                                                                                                                 |
| `mcp-client`             | mcp-endpoint                                  | per-server declared / companion for stdio | Remote servers: declared(host). Stdio servers: companion containers. The server's tool list is digest-pinned at registration; a server that changes its advertised tools mid-session is a G3-class contract drift and re-enters approval rather than silently gaining tools. OAuth flows terminate in the kernel secret store (hermes-agent's mcp_oauth pattern), never in model context. |
| `gateway-slack`          | gateway: `message.source/sink`                | declared(slack)                           | Socket Mode preferred so no inbound port is needed.                                                                                                                                                                                                                                                                                                                                       |
| `gateway-bluebubbles`    | gateway: `message.source/sink`                | lan                                       | iMessage requires the BlueBubbles server on a macOS host; that bridge is a `remote`-isolation component (§2), the one bundled thing that cannot be containerized. Pairing/allowlist before any sender reaches the agent.                                                                                                                                                                  |
| `gateway-email`          | gateway: `message.source/sink`                | declared(mail hosts)                      | SMTP out, IMAP in (assuming "snmp" meant SMTP). Inbound mail is the canonical A2 channel; stamped and sender-allowlisted.                                                                                                                                                                                                                                                                 |
| `gateway-gmail`          | gateway                                       | declared(googleapis)                      | Google SDK for full features (threads, labels, push via watch). OAuth refresh token lives in the kernel secret store; the gateway container receives short-lived access tokens via secret mount at open; nothing token-shaped ever enters a frame.                                                                                                                                        |
| `gateway-home-assistant` | gateway / mcp-endpoint                        | lan or loopback                           | Prefer HA's native MCP endpoint when present; fall back to REST API. Long-lived HA token via secret mount. Device actions are side effects and flow through the broker like any tool call.                                                                                                                                                                                                |
| `gateway-webhook`        | gateway: `message.source`                     | none (inbound only)                       | The only inbound door. HMAC/signature verification per route happens in the gateway before anything reaches the broker; unverifiable payloads are dropped and audited, never delivered. Payloads stamp at the route's configured classification.                                                                                                                                          |
| `cloudflared`            | extension + companion                         | declared(cloudflare edge)                 | Publishes the webhook gateway without opening a port. Tunnel token via secret mount into the companion only. The tunnel terminates at the webhook gateway's verified routes and nowhere else; cloudflared has no path to any other component.                                                                                                                                             |
| `scheduler`              | scheduler                                     | none                                      | §14e.                                                                                                                                                                                                                                                                                                                                                                                     |
| `files`                  | tool: `resource.reader/writer`                | none                                      | Path-set grants, workspace-jailed by the `tool-standard` template; escapes are explicit grant additions.                                                                                                                                                                                                                                                                                  |
| `terminal` / `ssh`       | tool: `tool.executor`                         | none / declared(hosts)                    | ssh host allowlist is the egress class; private keys stay in the secret store and the broker injects an agent socket into the tool container, so keys are unreadable even to the tool that uses them. Terminal output re-enters as untrusted content.                                                                                                                                     |
| `fetch`                  | tool                                          | declared(per-grant)                       | This is "curl": the brokered HTTP client of §8a, not a raw binary, so argument inspection and egress classes apply uniformly. A literal curl in `terminal` still can't exceed the container's egress class.                                                                                                                                                                               |

### 14d. Memory and learning: the hermes-agent method

Adopted from NousResearch/hermes-agent (verified against source, not recollection) and mapped onto Elliott's `memory.reader/writer` protocols. The method is three stores plus two loops; the only systematic delta is that every write carries a frame-classification stamp (§6b), which hermes-agent has no equivalent of and which costs one enum under the `standard` posture.

**Routing taxonomy: not everything learned is a memory.** Restored from Revision 1 and it composes cleanly with the hermes stores; the destination decides the governance path:

| Learned information                      | Destination                                                        |
| :--------------------------------------- | :----------------------------------------------------------------- |
| User fact or durable preference          | Curated memory (Store 1, `USER.md`) or semantic provider (Store 3) |
| Environment fact, convention, tool quirk | Curated memory (Store 1, `MEMORY.md`)                              |
| Prior interaction and outcome            | Episodic Record (Store 2, session store)                           |
| Reusable procedure                       | Skill authoring / Skill Proposal (Loop 1)                          |
| Presentation preference                  | InteractionProfile Overlay Proposal                                |
| Deterministic restriction                | Policy Proposal (§11c)                                             |
| New external action                      | Tool or Extension Proposal                                         |
| Transport behavior                       | Gateway Proposal                                                   |
| MCP configuration                        | MCP Endpoint Proposal                                              |
| Model routing change                     | Model Profile Proposal                                             |
| Tool implementation defect               | Package revision or issue, never a memory entry                    |

Semantic memory entries carry: subject, statement, scope, provenance, confidence, creation time, expiration or review time, contradiction links, and the classification stamp. Retrieved memory is contextual evidence and cannot grant permissions (§10a rules).

**Store 1 — `memory-curated` (bounded file memory).** Two §-delimited, character-bounded stores, following hermes `MEMORY.md` (agent notes: environment facts, conventions, quirks) and `USER.md` (user profile: preferences, style, habits). Injected into the system prompt as a **frozen snapshot at session start**; mid-session writes are durable immediately but do not touch the prompt, and the snapshot refreshes next session. This is hermes' prefix-cache preservation trick and it lands directly on §8b: the snapshot sits in the stable prefix ahead of the cache breakpoint. Writes go through the single `memory` tool with add/replace/remove actions and short-substring matching, kept verbatim because its ergonomics are proven.

**Store 2 — `memory-session-store` (SQLite, the system of record).** One SQLite database in WAL mode (concurrent readers, one writer, matching the gateway's multi-source reality), FTS5 virtual tables for full-text recall across all session messages, with trigram and CJK tokenizer variants as in hermes_state. Tables follow the hermes schema shape: sessions (with source tagging: cli, slack, imessage, …), messages, per-session model usage, gateway routing state, delegation state, and parent-session chains for compression-triggered session splits. This same database feeds the insights engine (usage, cost, tool patterns) and the learning graph, so analytics require no second store. SQLite ships zero-config as the default; deployments that outgrow it swap the provider, not the protocol.

**Store 3 — `memory-external` (single-slot semantic provider).** Hermes enforces exactly one external memory provider at a time (Honcho, Mem0, Hindsight, and similar) to prevent tool-schema bloat and conflicting backends; Elliott keeps the one-slot rule as registry policy on the `memory` kind. The hermes provider lifecycle maps one-to-one: `initialize`, `system_prompt_block`, `prefetch(query)` as background pre-turn recall, `sync_turn` as async post-turn write, `on_pre_compress` as extract-before-compaction, `on_session_end`, plus tool-schema exposure through the broker. Providers needing a database (pgvector, qdrant) declare it as a companion container (§14b) with `none` egress, which is how "every database necessary" ships without a single manual docker command.

**Loop 1 — learning is skill authoring.** Hermes' `/learn` turns anything describable (a directory, a doc URL, the current conversation) into a `SKILL.md` authored by the live agent under hardline authoring standards, with no separate distillation engine. Elliott adopts this whole: `/learn` builds the standards-guided prompt, the agent authors into workspace scope, and the result is an ordinary zero-authority skill (§9) until someone adds an overlay. Under `regulated` posture, agent-authored skills route through §11c Proposals before activation; under `standard` they activate directly, which is safe precisely because a bare SKILL.md carries no executable authority.

**Loop 2 — the curator.** A background, inactivity-triggered maintenance agent on an auxiliary model reviews agent-created skills: auto-transitions lifecycle states from usage timestamps, consolidates, patches, archives. Hermes' invariants adopt unchanged because they are exactly right: only touches agent-created skills, **never deletes, only archives** (recoverable), pinned skills bypass all auto-transitions, and it never touches the main session's prompt cache. In Elliott the curator is an `evaluator` component fired by the scheduler on idle, and its mutations are audit records; under `regulated` its consolidations become Proposals.

**Compression wiring.** Hermes extracts memory `on_pre_compress`, so knowledge is harvested before context compression discards it, and compression splits sessions along parent-chains in the state DB. This slots into §11d directly: extraction runs before compaction, and both the extraction and the compaction summary inherit the compacted frame's classification, keeping compaction a non-declassification path.

### 14e. Scheduler

Adopted shape: hermes runs cron via the gateway daemon ticking every 60 seconds against a file-locked job store, executing jobs in **isolated fresh sessions with no prior context**. Elliott keeps the tick-plus-lease execution model and the fresh-session rule (a scheduled job starting from a clean frame is both a correctness and an IFC property), with two adaptations. Jobs live in the session store (Store 2) rather than a JSON file, since the locking, WAL, and audit needs are already solved there. And authority is resolved **at fire time**: a job stores its principal and requested capabilities, never a grant snapshot, so every run resolves through the current epoch (§1a). A schedule cannot outlive its authority: revoke the principal or narrow the policy and the next fire fails closed with `blocked-no-route`-style typed disposition and an audit record, rather than running on embalmed permissions. Gate G25.

### 14f. Gateway pipelines, identity, and sessions

A gateway implements Protocols such as `message.source`, `message.sink`, `identity.resolver`, `attachment.reader`, `delivery.describer`, `health.checker`. It never contains the model loop.

**Inbound pipeline** (every bundled gateway, and the concrete shape behind G24):

```text
transport authentication → signature or connection verification
  → idempotency and deduplication → external identity resolution
  → principal authorization → message normalization → attachment quarantine
  → trust and classification assignment → agent and session routing
  → MessageEnvelope emission
```

**Outbound pipeline:**

```text
OutboundEnvelope → policy decision → destination binding
  → platform rendering → delivery → DeliveryReceipt Record
```

A gateway normally possesses only: its platform credential (§8c secret mount), network access to that platform (its egress class, §14a), the gateway worker protocol, and private operational state. It never possesses model-provider credentials, tool credentials, or unrestricted host access.

**Identity and sessions.** External identities link to internal principals explicitly (`gateway=slack, account=primary, externalId=U123 → principal=user:01J…`); identity is never inferred from matching display names or email addresses alone. The default multi-user isolation key is `tenant + gateway account + channel + thread + principal`. A session key is routing information, not authentication: authorization is rechecked on every inbound message and every approval decision (invariant 7, §0f, served by the §1a epoch path). This is the pairing/allowlist machinery the §14c table references for BlueBubbles and email.

### 14g. MCP architecture

One external MCP server = one `mcp-endpoint` component; Elliott capabilities exposed outward use `mcp-exposure`.

**Virtual child components.** Discovered MCP artifacts materialize as endpoint-qualified virtual children so all existing machinery (grants, discovery cards, IFC stamping) applies to them uniformly:

```text
MCP tool     → tool component        mcp.github.tool.create-issue
MCP resource → resource component    mcp.github.resource.repository
MCP prompt   → prompt.source component  mcp.github.prompt.triage-issue
```

**Endpoint lifecycle:** connect → negotiate protocol and capabilities → retrieve tools/resources/prompts → validate schemas → compute catalog digest → apply policy filters → create virtual child descriptors → mark healthy. Catalog changes create a new digest and Snapshot (this is the digest-pinning behind the §14c table row); existing runs retain their original Snapshot, and drift re-enters approval.

**Security rules:** every endpoint has a distinct principal; local stdio servers run as companion containers (§14b) with an empty environment by default; remote endpoints use endpoint-specific authentication with audience-bound tokens; token passthrough is prohibited; MCP responses are external, untrusted, and stamped at the endpoint's classification; MCP prompts are templates, never host-level instructions; sampling, elicitation, and roots require explicit reverse Grants.

**Version seam.** The stable MCP protocol generation and any future breaking generation live behind separate drivers (`McpProtocolDriver { era: "legacy" | "modern"; discover(); invoke() }`), so a protocol break is a driver addition, not an endpoint rewrite.

## 15. Nomenclature and Naming Conventions

### 15a. Nomenclature

Public terminology, with the Revision 1 → current mapping recorded so old documents and code remain readable:

| Current term           | Revision 1 term | Meaning                                                                              |
| :--------------------- | :-------------- | :----------------------------------------------------------------------------------- |
| Component              | Facet           | Universal framework artifact                                                         |
| Protocol               | Protocol        | Schema-backed behavior contract                                                      |
| ComponentSchema        | FacetType       | Runtime kind and schema description                                                  |
| ComponentManifest      | Descriptor      | Validated static metadata                                                            |
| ComponentInstance      | Binding         | Scoped runtime instance                                                              |
| Capability             | Capability      | Named, resource-scoped authority                                                     |
| GrantSet / GrantHandle | GrantSet        | Effective authority (now epoch-resolved, §1a)                                        |
| Invocation             | Invocation      | Prepared operation request                                                           |
| Record                 | Record          | Immutable runtime fact                                                               |
| Proposal               | Proposal        | Candidate control-plane change                                                       |
| Snapshot               | Snapshot        | Immutable runtime resolution                                                         |
| InteractionProfile     | Persona         | Identity and interaction behavior, zero authority                                    |
| Agent                  | Agent           | Composition root                                                                     |
| AgentTopology          | Fleet           | Multi-agent composition and routing                                                  |
| Extension              | Extension       | Installable package contributing Components                                          |
| Curator                | Curator         | Skill-maintenance evaluator (§14d); learning-loop authorities are separated per §11c |
| **SecurityTag**        | Taint           | Untrusted-content marking carried by frames, envelopes, and prompt segments          |

`AgentKernel` is the implementation name for the service containing the Registry, Authorizer, and Capability Broker; logs and APIs use standard security terminology, never product codenames. `Plugin` is a marketplace alias for Extension, not a distinct runtime kind.

### 15b. Naming conventions

**Logical component references:** `<namespace>/<kind>/<name>`, e.g. `acme/tool/create-issue`, `workspace/skill/release-notes`, `core/policy/default`, `workspace/gateway/slack`, `workspace/mcp-endpoint/github`. Exact revision: `acme/tool/create-issue@1.4.0#sha256:abc123`.

**Protocol names:** `<domain>.<interface>` — `message.source`, `message.sink`, `tool.executor`, `policy.decider`, `prompt.source`, `health.checker`, `memory.reader`, `search.provider`, `content.extractor`.

**Capabilities:** `<resource>.<action>` — `fs.read`, `fs.write`, `network.connect` (parameterized by egress class, §14a), `secret.use`, `message.send`, `agent.delegate`, `model.use.deep`, `proposal.create`, `process.execute`.

**Events:** `<domain>.<entity>.<past-tense-action>` — `gateway.message.received`, `model.selection.completed`, `tool.invocation.completed`, `policy.decision.denied`, `proposal.revision.created`, `release.component.promoted`, `epoch.scope.bumped`, `sanitizer.merge.rejected`.

**Package names:** `@<organization>/elliott-<kind>-<name>`, e.g. `@acme/elliott-gateway-slack`.

## 16. Directory Conventions, Component Layout, and Manifest Examples

### 16a. Directory conventions

**Elliott framework repository:**

```text
elliott/
├── src/
│   ├── core/            # component/ protocol/ schema/ instance/ registry/ snapshot/ epoch/
│   ├── security/        # capability/ policy/ grants/ approvals/ secrets/ broker/
│   │                    # ifc/ sanitizer/ residency/
│   ├── manifest/        # markdown.ts yaml.ts agentskills.ts templates/ schemas/
│   ├── model/           # provider.ts profile.ts resolver.ts routetable.ts catalog.ts
│   │                    # stream.ts records.ts
│   ├── providers/       # litellm/ ollama/
│   ├── gateway/
│   ├── mcp/             # endpoint/ exposure/ legacy-driver/ modern-driver/
│   ├── prompt/
│   ├── memory/          # curated/ session-store/ external-slot/
│   ├── learning/        # signals/ proposals/ evaluation/ curator/
│   ├── scheduler/
│   ├── placement/       # pools/ companions/ cgroups/
│   ├── audit/           # shards/ crosslink/ durability/
│   ├── hotcore/         # Rust N-API bindings (§12c)
│   ├── loop/
│   ├── observability/
│   └── config/          # postures/ activation/
├── test/                # conformance/ (gates G1–G25) unit/ fuzz/
├── package.json
└── tsconfig.json
```

**Consumer repository:**

```text
my-agent/
├── agent.yaml
├── AGENTS.md
├── .agents/
│   └── skills/
│       └── commit-message-formatter/     # standard layout, §16b
├── .elliott/
│   ├── models.yaml                       # §5c
│   ├── policy.yaml
│   ├── posture.yaml                      # §0e
│   ├── lock.yaml                         # resolution + shadowing visibility, §3
│   ├── components/
│   │   ├── gateways/  mcp/  extensions/  interaction-profiles/
│   │   ├── evaluators/  model-providers/  memory/
│   └── tests/
└── package.json
```

**Platform state** (configuration, source, state, cache, audit, and secrets always separate):

```text
~/.config/elliott/          # config.yaml  trust/  policies/
~/.local/share/elliott/     # memory/  records/  proposals/  snapshots/  sessions/
~/.local/share/elliott/audit/   # hash-chain shards + cross-links (§12a), append-only volume in §12b
~/.cache/elliott/           # catalogs/  schemas/  routetables/  validation/  model/
```

Everything under `~/.cache` is reconstructable and can be deleted at any time; the §0d caches live here, and a wiped cache costs one recomputation, never a behavior change.

### 16b. Standard component layout

```text
<component-name>/
├── manifest.yaml       # security overlay; absent = zero executable authority
├── <KIND>.md            # standard document, prompt-visible per kind rules
├── schemas/  src/  tests/  evals/  references/  assets/  migrations/
```

Only applicable directories need to exist. Standard Markdown names per kind: `AGENT.md`, `SKILL.md`, `TOOL.md`, `GATEWAY.md`, `MCP.md` (endpoint and exposure), `EXTENSION.md`, `INTERACTION_PROFILE.md`, `POLICY.md`, `EVALUATOR.md`, `RESOURCE.md`, `MODEL_PROVIDER.md`, `MODEL_PROFILE.md`, `MEMORY_PROVIDER.md`, `SCHEDULER.md`. `README.md` is developer documentation and is never automatically added to prompt context.

### 16c. Example component manifest (full form)

The one-line template form (§9a) expands to this; authors write whichever end of the spectrum fits:

```yaml
apiVersion: elliott/v1
kind: gateway

metadata:
  namespace: acme
  name: slack
  version: 1.3.0
  description: Receives and delivers Slack messages.

spec:
  document: GATEWAY.md
  schema: { kind: gateway, apiVersion: elliott/v1, digest: "sha256:…" } # SchemaRef, §2

  runtime:
    module: ./dist/worker.js
    export: slackGatewayModule
    isolation: container # ≥ schema minimumIsolation, §2a

  protocols:
    - message.source
    - message.sink
    - identity.resolver
    - health.checker

  configSchema: schemas/config.schema.json

  egress: declared # §14a
  egressHosts: ["https://slack.com/**", "https://slack-edge.com/**"]

  capabilities:
    request:
      - capability: secret.use
        resources:
          - secret://gateways/slack/bot-token
          - secret://gateways/slack/signing-secret
      - capability: state.write
        resources: ["state://self/**"]

  limits: # ResourceLimitRequest, §1 (min-composed, cgroup-compiled §12b)
    maxConcurrency: 32
    memoryMb: 256

  lifecycle:
    startupTimeout: 30s
    shutdownTimeout: 10s
    required: false

  dependencies:
    - ref: core/policy/default
      protocol: policy.decider

integrity:
  source: npm:@acme/elliott-gateway-slack@1.3.0
  digest: sha256:0123456789abcdef
  signature: sigstore://example
  sbom: sbom.json
```

### 16d. Example agent composition

```yaml
apiVersion: elliott/v1
kind: agent

metadata: { namespace: local, name: ada-assistant, version: 1.0.0 }

spec:
  interactionProfile: { ref: workspace/interaction-profile/ada }

  models:
    defaultProfile: balanced
    maximumProfile: deep # capability-only ordering, §5a

  skills:
    - workspace/skill/commit-message-formatter
    - workspace/skill/pdf-processing

  memory:
    curated: { ref: builtin/memory/curated } # §14d Store 1
    sessions: { ref: builtin/memory/session-store } # §14d Store 2
    external: { ref: workspace/memory/mem0 } # §14d Store 3, single slot

  gateways:
    - ref: workspace/gateway/slack
    - ref: builtin/gateway/cli

  mcp:
    - ref: workspace/mcp-endpoint/github

  policies:
    - ref: organization/policy/baseline
    - ref: workspace/policy/default

  evaluators:
    - ref: core/evaluator/task-outcome

  capabilityCeiling: # child components intersect against this, §1
    - fs.read:workspace/**
    - process.execute:git
    - model.use.deep

  learning: { mode: proposals, autoApply: false }
```

An Agent is a declarative composition root, not a custom subclass of the model loop.

### 16e. TypeScript standards

Recommended compiler settings: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`. Additional standards: `readonly` by default; `unknown` at trust boundaries; discriminated unions for protocol states (§11a is the pattern); no decorators for registration; no import-time registration side effects; no global mutable Registry; no service locator exposed to components; no direct cross-component method calls; every operation has input and output schemas; every side effect emits a Record; every run references an immutable Snapshot. Prefer `new URL(".", import.meta.url)` over runtime-specific path APIs (§12).

## 17. Rollout, Open Questions, and Final Architecture

### 17a. Milestones

Milestones sequence the phases of §0c; gate columns use current numbering:

| Milestone                        | Scope                                                               | Gates                       |
| :------------------------------- | :------------------------------------------------------------------ | :-------------------------- |
| M0 — spine                       | Component, Protocol, Manifest, Instance, schemas, discovery, epochs | G1, G3, G17                 |
| M1 — loop                        | Agent loop, prompt segments, typed dispositions, compaction         | —                           |
| M2 — registry and skills         | Registry, Agent Skills loader, templates, compact discovery         | G5                          |
| M3 — observability               | Records, audit shards, footprint attribution                        | G11, G16, G20               |
| M4 — model profiles              | Provider protocol, route tables, LiteLLM/Ollama adapters            | G2, G8–G11, G13, G18        |
| M5 — trust boundary              | Grants, broker, approvals, secrets, pools, container profile        | G4, G6, G12, G21            |
| M6 — gateways and MCP            | Gateway protocols, MCP drivers, virtual children, companions        | G23, G24                    |
| M7 — memory, scheduler, learning | Hermes-method stores, curator, Proposals, sanitizers, postures      | G7, G14, G15, G19, G22, G25 |
| M8 — consumer agent              | First separate agent repo installs Elliott end to end               | All                         |

Two revision thresholds carry over from Revision 1 verbatim because they are good tripwires: if monotonic GrantSet intersection cannot express a real policy without escape-hatch flags, add a typed effect layer before adding ad hoc booleans; and if evaluator scores improve while independent external-anchor metrics remain flat across two review cycles, require manual review for every learned change until the discrepancy is resolved.

### 17b. Open questions

Restored from Revision 1, annotated with what later revisions resolved:

- Bun as preferred local runtime versus Node as primary. **Open** (package contract is Node ≥22 ESM, §12; Bun remains a CI target).
- Runtime schema adapter: TypeBox+Ajv, Zod, Valibot, or a neutral adapter package. **Open**; §7a requires only that Layer-1 validators compile at Proposal activation.
- Process versus container default for locally authored third-party components. **Resolved**: the container deployment profile collapses both to pooled containers (§12b).
- Postgres+pgvector versus a dedicated vector database. **Resolved as "neither is privileged"**: single external slot + companion containers (§14d); SQLite is the zero-config system of record.
- TypeScript-only executable exports versus Python/shell workers. **Open**; the isolation and IPC contracts (§2) are language-neutral by construction.
- Whether `model.use.deep` requires approval by default. **Mechanism resolved** (deferred grants, §1; posture defaults, §0e); the default itself is a posture decision. **Open** at `standard`.
- Whether model-profile bindings can be packaged as organization policy. **Resolved**: yes, via org pinning and Proposal-governed config (§3, §11b).
- How strongly to enforce footprint budgets in CI. **Open**; §11d defines the measures, not the thresholds.
- Whether evaluator independence requires a different provider or only a different deployment. **Open**; §11c requires excluding the authoring route as the floor.
- MCP legacy/modern driver support timelines. **Open**; the seam exists (§14g).
- Whether Git integration is core or an optional projection of Proposal/Release Records. **Open**; Proposal-as-directory (§11c) keeps both paths viable.

### 17c. Final architecture

```text
abstract class Component
  + ComponentSchema  + ComponentManifest  + schema-backed Protocols
  + ComponentModule  + ComponentInstance  + restricted ComponentContext
```

```text
one Registry + one Authorizer + one Capability Broker
  + one Envelope format + one Record store (sharded, chained)
  + one Proposal workflow + immutable Snapshots
  + epoch-checked caches over all of it (§0d)
  + pooled isolated workers and companions (§2b, §14b)
  + provider-neutral model profiles over kernel-enforced residency
  + a single-level default posture that hardens by configuration (§0e)
```

Skills, tools, gateways, MCP endpoints, extensions, interaction profiles, memories, policies, model providers, model profiles, evaluators, schedulers, Agents, and AgentTopologies are different Component kinds rather than separate plugin architectures. When a new capability does not fit, Elliott adds a narrow schema-backed Protocol before adding another manager, inheritance layer, or privileged subsystem.
