# The security model

Every shape in this codebase follows from one premise, so it is worth stating
plainly: a personal agent runs untrusted content through powerful tools on your
behalf. That is a security problem wearing a productivity costume.

Take the premise seriously and most of the design decides itself.

## No ambient authority

Components receive scoped handles and brokered grants. They never receive the
host environment.

Ambient authority is the failure mode where a component can do a thing because
it happens to be running inside a process that can do that thing. It is the
default in most plugin systems, and it makes the question "what can this skill
reach?" unanswerable without reading its source. Here the manifest answers it,
before the source runs.

## Inference is not authorization

A model may suggest an action. It cannot grant a permission, widen a grant, or
route around the capability broker.

This sounds obvious and is violated constantly, usually by accident: a tool that
takes a path from the model and opens it, a gateway that treats a model-authored
field as a routing decision. The test is whether a sufficiently persuasive
paragraph could change what the process is allowed to do. If it could, the
enforcement is in the wrong place.

Enforcement lives outside the model. Policy, grants, approvals, sandboxing,
secrets, and execution are deterministic runtime responsibilities, never
prompt-level requests to behave.

## Everything a model reads is executable context

Tool output, gateway messages, fetched pages, email bodies. All of it is
untrusted evidence, and none of it is instructions.

The loop enforces this by framing: results come back marked
`[UNTRUSTED TOOL OUTPUT]` and external content never gains instruction
precedence. If you touch the loop or a gateway, keep the framing. Removing it
breaks nothing visible, which is exactly what makes it a security regression
worth naming here.

## Allowlists fail closed

A skill with no allowlist registers nothing.

`terminal` with an empty `allowed_commands`, `ssh` with an empty `hosts`, an
email gateway with no recipient list: each registers nothing rather than
registering something permissive. Missing configuration degrades to absence of
capability, never to a default grant.

The corollary is that registration failure is non-fatal by design. A broken or
unprovisioned skill degrades while the rest of the runtime boots. That choice
buys availability and costs silence, and the silence is the real risk, which is
why every skill carries a smoke test. See [Testing strategy](testing-strategy.md).

## Secrets are opaque references

Configuration holds `${ENV:VAR}` and `${VAULT:path#field}`, resolved once at the
config boundary. Nothing else in the tree reads `process.env`, and a lint rule
keeps it that way.

No secret value is hardcoded, logged, or interpolated into an error that leaves
the process. That last clause is narrower than it looks and does real work: the
error reporter transmits an error class, its stack frames, and the mechanism,
and leaves the message in the local console. The message is the one field that
can carry an interpolated secret, so it does not travel. No DSN, token, or Vault
path can appear in a transmitted payload by construction rather than by
vigilance.

Telemetry gets digests. The audit trail stores `argumentsDigest` and
`resultDigest`, never raw arguments or output.

## Fact-forcing beats confirmation prompts

"Are you sure?" is worthless as an approval surface. It invites a reflexive yes,
and the person clicking it has been trained by a hundred harmless dialogs to
click it without reading.

An approval request has to enumerate the concrete targets and a one-line
rollback plan. Facts are the approval surface. This is the direction
`src/security/approvals` is heading: requests that carry facts, not a boolean.

## Learning produces proposals, not mutations

A running agent cannot rewrite active policy, skills, or executable components.
Self-improvement flows through proposals with separated authorities: review,
canary, rollback.

A self-modifying agent must also never evolve away its own injection resistance,
so a deterministic prompt-injection benchmark runs ahead of the expensive
benchmarks in the promotion ladder and fails any candidate whose artifact
carries injection or safety-bypass signatures.

## Fix the code, not the gate

Quality gates ratchet. Coverage floors move up only, `lint:strict` means zero
warnings, and hook bypasses are blocked. Gate files are protected from agent
edits; changing one is an operator decision.

This is the same doctrine as the runtime, applied to the repository. Fail
closed, ratchet forward, and keep enforcement outside the thing being enforced.
A gate an agent can edit is not a gate.

The gates themselves: [Quality gates](../reference/quality-gates.md).

## What this model does not claim

Governance on the live tool path is default-allow, not default-deny. The value
there is the trail, the attribution, the explicit denials, and the kill switch.
A from-scratch allowlist over every tool would be large, risky, and would break
production quietly. One high-risk tool, `ssh_exec`, is migrated onto true
default-deny through the broker, and that is the pattern for the next one.

Being honest about that gap is more useful than a document claiming the
enforcement is stronger than it is. See [Governance](governance.md).
