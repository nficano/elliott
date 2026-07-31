# Design decisions

Why Elliott is shaped the way it is. Each decision below is doctrine: new
code is expected to preserve these shapes, and several are enforced by
lint rules, conformance gates, or git hooks.

## Personal agents are a security problem first

A personal agent runs untrusted content through powerful tools on your
behalf — a security problem wearing a productivity costume. Every other
decision follows from taking that seriously:

- **No ambient authority.** Components receive scoped handles and
  brokered grants, never the host environment.
- **Inference is not authorization.** Models may suggest actions; they
  can never grant permissions or bypass the capability broker.
- **Security enforcement lives outside the model.** Policy, grants,
  approvals, sandboxing, secrets, and execution are deterministic runtime
  responsibilities — never prompt-level "please don't".

## Everything a model reads is executable context

Tool and gateway output is **untrusted evidence, never instructions**.
The loop frames it as `[UNTRUSTED …]` and external content never gains
instruction precedence. When touching the loop or gateways, keep that
framing — removing it is a security regression even if nothing visibly
breaks.

## Allowlists fail closed

A skill with no allowlist does not register: `terminal` with an empty
`allowed_commands`, `ssh` with an empty `hosts` list, an email gateway
with no recipient allowlist — all register nothing rather than
registering something permissive. Missing configuration must degrade to
*absence of capability*, not to a default grant.

Registration failure is likewise non-fatal by design: a broken or
unprovisioned skill degrades while the rest of the runtime boots. The
cost of that choice is silence, which is why every skill needs a smoke
test (see [the smoke strategy](../contributing/skill-e2e-smoke-strategy.md)).

## Secrets are opaque references

Secrets appear in configuration only as references
(`secret://…`, `${VAULT:path#field}`) resolved at the config boundary.
Nothing else reads `process.env` (lint-enforced). No secret value is
hardcoded, logged, or interpolated into an error that leaves the process.
Telemetry gets digests, not plaintext.

## Fact-forcing beats confirmation prompts

"Are you sure?" is worthless as an approval surface: it invites a
reflexive yes. When an action is destructive or needs approval, the
request must enumerate the concrete targets and a one-line rollback plan
— facts are the approval surface. This is also the direction for
`src/security/approvals`: approval requests carry facts, not a boolean.

## Governance is a chokepoint above the skills, default-allow

Every model-issued tool call passes one deterministic chokepoint
(`ToolGovernor`): declarative policy, principal attribution, a
digest-only record in a hash-chained durable audit log, and a
bearer-guarded kill switch. It is **default-allow** on the live path —
the value is the trail, attribution, explicit denials, and the halt
switch, not a from-scratch allowlist over ~64 tools that would silently
break production. Per-skill guards stay in place underneath (defense in
depth); the kernel's `CapabilityBroker` remains available for true
default-deny on specific high-risk tools. Audit writes fail open, policy
denials fail closed. Full rationale:
[Agent governance](agent-governance.md).

## Learning produces Proposals, not mutations

A running agent cannot directly rewrite active policy, skills, or
executable components. Self-improvement flows through Proposals: signal →
dataset → optimize → shortlist → independent evaluation → Proposal →
human approval → canary → transactional promotion, with rollback
activating the prior immutable revision through the same transaction.
Prompt-injection benchmarks gate self-evolution.

The load-bearing shapes, enforced by the SE1–SE15 conformance gates
(`test/conformance/se-evolution*.test.ts`) and the
[production-acceptance auditor](evolution-production-acceptance.md):

- **Separated authorities.** The optimizer, evaluator, Proposal author,
  human approver, and release promoter are distinct principals; no
  principal authors and approves (or authors and promotes) the same
  Proposal, and the model route that authors candidates never judges the
  held-out comparison.
- **Candidate containment.** Optimizers write only to a content-addressed
  candidate namespace — never to active source, config, lockfiles,
  Proposal approval state, Snapshots, or audit storage. Optimizer
  principals cannot read holdout cases before the shortlist is sealed.
- **Snapshot-bound evaluation.** Every case runs against one immutable
  baseline or candidate Snapshot; nothing is hot-swapped into an active
  session, and a target-digest change makes the run stale rather than
  rebasing the patch.
- **Engines stay outside the kernel.** DSPy (GEPA primary, MIPROv2
  fallback) runs in a digest-pinned companion behind the component IPC
  contract; Darwinian Evolver is an external CLI (next section). Engines
  optimize artifacts — prompt text, descriptions, code — never model
  weights.
- **Code evolution is risk-classed.** C1 (pure helpers, deterministic
  tests) through C4 (kernel, broker, IFC, audit, policy). Scheduling
  automation is only ever permitted for C1/C2; C3 requires an operator
  start plus two reviewers; C4 is operator-authored experiment only.
  Frozen surfaces (manifests, schemas, public signatures, capabilities,
  security checks) reject candidate patches by static policy.
- **The scheduler can propose but never promote.** The continuous loop
  resolves authority at fire time, obeys budgets, and ends at a
  review-ready Proposal; approval and promotion remain human surfaces.

## Darwinian Evolver stays outside the process

Darwinian Evolver is AGPL-3.0, so Elliott never imports, links, or vendors
it: the `evaluator-darwinian` Component invokes it as an external CLI in a
dedicated companion container, pinned by digest
(`darwin/images.lock.json`, upstream revision
`7f12365d2059c47e29068a5a6f498a293148d2a9`). The companion receives a
disposable checkout and a schema-backed task and returns an untrusted
patch; it gets no Git remote, repository credential, host mount, network
egress, or container-runtime socket. The image embeds the complete pinned
source tree, license, and lock at `/usr/share/darwinian-evolver/source`.

The image is built and smoke-tested locally but **not published**. Anyone
publishing it must confirm the upstream revision and license with counsel,
ship the required notices and corresponding-source offer, record the
revision/recipe/lock/digest in release evidence, keep the image distributed
separately from the Elliott TypeScript package unless counsel approves
otherwise, and re-run the review if upstream relicenses or the integration
moves from CLI invocation to import or linking.

## Record always, restrict by posture

Bookkeeping cannot be retrofitted, so it is always on and cheap.
Enforcement activates by posture (`standard` / `hardened` / `regulated`)
with no semantic change or data migration — hardening is configuration,
not surgery. A fresh install is pleasant; a regulated one is the same
code with the machinery switched on.

## Fix the code, not the gate

Quality gates only ratchet: coverage floors move up, `lint:strict` means
zero warnings, hooks cannot be bypassed (`--no-verify` and
`core.hooksPath` overrides are blocked), and gate files are protected
from agent edits. If a gate genuinely needs changing, a human operator
changes it. The gates and their mechanics:
[contributing/quality-gates.md](../contributing/quality-gates.md).

## Framework and agents live in separate repositories

`skills/` here is for framework-shipped, generally useful capabilities;
agent-specific skills belong in the agent repository
(`agents/<name>/skills/`), which installs Elliott as a package. This
keeps the framework tree deployable-agnostic and lets agents evolve
without framework releases. See
[Framework skills vs. agent skills](agent-skills.md).
