# Governance

Every model-issued tool call passes one deterministic chokepoint. This page
explains what that buys, what it deliberately does not attempt, and why the
posture is default-allow.

## The gap it closed

elliott already shipped a purpose-built governance apparatus in `src/security/*`
and `src/audit/*`: a capability broker, a grant manager, a Merkle-linked audit
log, an opaque secret store. The problem was that the production runtime never
called any of it.

The live tool path did no authorization. The kernel booted with an in-memory
audit adapter, so the trail evaporated on restart. The only identity reaching a
tool handler was the human who sent the message.

So the work was wiring dormant machinery to the live path, not importing
something new onto elliott's most security-critical seam. The diagnosis came
from [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit),
whose threat model fit exactly. Its prescription did not, because elliott's own
apparatus was already there and unused.

## What runs on every call

`ToolGovernor.guard` replaces a tool's `execute` with a wrapper that evaluates
policy plus kill-switch state, appends a durable `tool.invocation` record
carrying the agent, the actor, the arguments digest, and the decision, then
either denies or runs the real tool and appends an observational `tool.result`
record.

A denial throws `GovernanceDeniedError`, which the agent loop already converts
into an ordinary `[error]` tool message. The model learns it cannot take the
action. The process keeps serving.

The audit log is durable now: a `FileCommitAdapter` writing
`.elliott-runtime/audit/records.jsonl` replaced the ephemeral memory adapter.

## Why default-allow

This is the design choice most worth defending, because it reads like a
weakness.

The alternative is a from-scratch allowlist enumerating the capabilities of
roughly sixty-four existing tools. That list would be large, it would be wrong
in ways nobody notices until production breaks, and writing it would be the kind
of security theater that produces a document rather than a defense.

The value on the live path is the trail, per-agent attribution, explicit
denials, and a kill switch that works during an incident. Those are real and
they arrive on day one. Denials are explicit configuration, so anything you know
you want blocked gets blocked.

True default-deny is available where it earns its cost. `ssh_exec` runs remote
commands, so it migrated onto the kernel `CapabilityBroker`: `CapabilityGate`
seeds a grant whose resources are exactly the configured host allowlist and
routes execution through `CapabilityBroker.execute`, which materializes a grant
for `(ssh.exec, <host>)` and throws for anything not covered.

That migration is behavior-preserving on purpose. The granted resources equal
the SSH skill's own allowlist, so every host the skill would have run still
runs, and a non-allowlisted host is denied one layer earlier and audited as
`broker.dispatch`. The skill's own guard still rejects it too.

That is the pattern for the next high-risk tool. One at a time, each one
behavior-preserving, each one tested.

## Defense in depth, not replacement

Per-skill guards stay: the SSH host allowlist, the SMTP recipient allowlist, the
terminal command allowlist. Governance is a layer above them.

The layering shows up in the trail. An SSH call produces `tool.invocation`, then
`broker.dispatch`, then the real call, then `broker.result`, then `tool.result`.

## Digests only

Invocation records store `argumentsDigest` and `resultDigest`. Never raw
arguments, never raw output. This preserves the runtime's no-plaintext-in-telemetry
posture, and it means the audit log can be shipped somewhere less trusted than
the runtime itself.

## Failure directions

Audit writes fail open. Policy denials fail closed.

A disk hiccup cannot take down the agent, so a write failure is reported and
swallowed. The deny decision is computed before the write and enforced whether
or not the record landed. Getting these two backwards is the classic way to turn
a logging outage into an availability outage, or a policy engine into a
suggestion.

## The kill switch

`/v1/control/governance` exists only when `ELLIOTT_GOVERNANCE_TOKEN` is set,
guarded by a bearer token compared in constant time. It can disable one tool or
freeze all of them without a restart.

Toggles are themselves written to the trail, so who-killed-what is attributable.
Operating it: [How to operate the governance kill switch](../guides/operate-the-governance-kill-switch.md).

## Self-evolution and injection

A self-modifying agent must not evolve away its own injection resistance, and
the evolution engine must not be steered into promoting an artifact that is
itself an injection payload.

A native deterministic benchmark scans a candidate's materialized artifact for
injection and safety-bypass signatures: ignore-previous-instructions,
disregard-safety, exfiltrate-secrets, trust-untrusted-content,
developer-jailbreak. It runs in-process and sits at the front of the recurring
benchmark ladder, so it short-circuits promotion before the expensive HTTP
benchmarks run.

## Known limits

The injection corpus is a starting signature set, not a complete benchmark.
Broadening it is incremental work in the corpus file.

`tool.result` records are observational and flush on cross-link or stop, so a
crash mid-turn can lose buffered results. The security-relevant records,
`tool.invocation` and denials, are effect-gating and durable immediately. That
asymmetry is deliberate, and it is the right one if you have to pick.

Controls map to the OWASP Agentic Top-10 in
[`g26-agent-governance.test.ts`](../../test/conformance/g26-agent-governance.test.ts),
which is where the mapping is asserted rather than asserted in prose.
