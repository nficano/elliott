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
executable components. Self-improvement flows through Proposals with
separated authorities — review, canary, rollback — and prompt-injection
benchmarks gate self-evolution. See
[the darwin adoption plan](darwin/elliott-self-evolution-adoption-plan.md).

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
