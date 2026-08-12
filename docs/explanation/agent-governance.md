# Agent governance: policy, identity, and a tamper-evident tool trail

Status: landed · 2026-07-29

> **What landed:** a `ToolGovernor` (`src/runtime/governance/`) wraps every
> model-issued tool call at the `collectTools` assembly seam
> (`src/runtime/app.ts` `#installGovernance`), so all ~64 tools now pass through
> one deterministic chokepoint that (1) evaluates a declarative allow/deny
> policy, (2) attributes the call to a principal (`GovernancePrincipal` on
> `ToolExecutionContext`), (3) writes a digest-only record to the kernel's
> hash-chained `AuditLog`, and (4) can be halted at runtime via a bearer-guarded
> control plane at `/v1/control/governance`. The audit log is now durable: the
> kernel is injected with a `FileCommitAdapter`
> (`.elliott-runtime/audit/records.jsonl`) instead of the ephemeral
> `MemoryCommitAdapter`. Tests: `test/unit/governance.test.ts`,
> `test/unit/audit-durability.test.ts`,
> `test/conformance/g26-agent-governance.test.ts`.

## Why

This is elliott's adoption of the ideas in
[microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
— **without** taking the dependency. The toolkit's diagnosis fit elliott
exactly: an agent needs deterministic, application-layer enforcement (not
prompt-level "please don't"), agent-identity attribution in a multi-agent
system, and a tamper-evident audit trail. The prescription did **not** fit:
elliott already ships a purpose-built governance apparatus in `src/security/*`
and `src/audit/*` (capability broker, grant manager, Merkle-linked audit log,
opaque secret store). The gap was that the **production runtime never called
it** — the live tool path (`RuntimeAgent.#execute`) did zero authorization, the
kernel booted with an in-memory audit adapter, and the only tool identity
reaching a handler was the human Slack sender.

So this work wires the dormant machinery to the live path rather than importing
a third party onto elliott's most security-critical seam.

## Design choices

- **Default-allow, not default-deny.** The security value on the live path is
  the audit trail, per-agent attribution, declarative denials, and the runtime
  kill switch — not a from-scratch allow-list enumerating the capabilities of
  every one of ~64 existing tools (which would be large and risky, and could
  silently break production). Denials are explicit config; the kernel
  `CapabilityBroker` (`src/security/broker/broker.ts`) remains available for
  true default-deny capability enforcement on a specific high-risk tool later.
- **Defense in depth, not replacement.** The existing per-skill guards (SSH
  host allow-list, SMTP recipient allow-list, terminal command allow-list) stay.
  Governance is a centralized layer _above_ them, not a substitute — a denied
  SSH host is still rejected inside the skill even if policy allowed the tool.
- **Digests only.** Invocation records store `argumentsDigest` /
  `resultDigest`, never raw arguments or output, preserving the runtime's
  existing "no plaintext in telemetry" posture.
- **Fail-open on logging, fail-closed on policy.** An audit-write failure is
  reported and swallowed so a disk hiccup cannot take down the agent; the deny
  decision is computed before the write and enforced regardless of whether the
  record landed.

## What runs on every tool call

`ToolGovernor.guard` replaces a tool's `execute` with a wrapper that:

1. Evaluates `GovernancePolicy` + kill-switch state → `{ effect, reason }`.
2. Appends a `tool.invocation` record (`effect-gating`, durable) carrying the
   agent, actor, `argumentsDigest`, and the decision.
3. On deny, throws `GovernanceDeniedError` — which `RuntimeAgent.#execute`
   already turns into an ordinary `[error]` tool message, so the model learns it
   cannot take the action without the process crashing.
4. On allow, runs the real tool, then appends a `tool.result` record
   (`observational`) with the `resultDigest`.

Kill-switch toggles (`governance.tool-disabled`, `governance.frozen`, …) are
themselves written to the trail, so who-killed-what is attributable.

## Operating the kill switch

`/v1/control/governance` opens only when `ELLIOTT_GOVERNANCE_TOKEN` is set
(config: `governance.deny: [toolName, …]` for static denials). Bearer-token
auth, timing-safe compare, mirroring `/v1/control/evolution`.

```
# current state
curl -H "authorization: Bearer $TOKEN" https://<runtime>/v1/control/governance

# disable a single tool at runtime (no restart)
curl -X POST -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"op":"disable","tool":"ssh_run"}' https://<runtime>/v1/control/governance

# freeze all tools (incident break-glass); "unfreeze" to restore
curl -X POST -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"op":"freeze"}' https://<runtime>/v1/control/governance
```

## OWASP Agentic Top-10 coverage (the borrowed checklist)

The toolkit's threat model, used here as a conformance checklist. Each mapped
control is asserted in `test/conformance/g26-agent-governance.test.ts`.

| Threat theme                             | Control in elliott                                          | Enforcement point                        |
| ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| Excessive agency / tool misuse           | Deterministic policy deny + runtime disable + freeze        | `ToolGovernor.#decide`                   |
| Identity spoofing / attribution          | `GovernancePrincipal` (agent + actor) bound to every record | `#invocationDraft`                       |
| Repudiation / insufficient logging       | Hash-chained, Merkle-cross-linked, durable audit trail      | `AuditLog` + `FileCommitAdapter`         |
| Privilege escalation via control surface | Bearer-guarded, timing-safe kill-switch route               | `makeGovernanceControlPlane`             |
| Sensitive information disclosure         | Digest-only records; secret-egress guard on broker path     | `#invocationDraft` / `OpaqueSecretStore` |
| Unbounded consumption                    | (existing) model watchdog + round/output caps               | `RuntimeAgent`, `ModelCallWatchdog`      |

## SSH: default-deny capability grants through the real broker

The default-allow policy is the right posture for ~64 general tools; a single
high-risk one — `ssh_exec`, which runs commands on remote hosts — is migrated
onto the kernel `CapabilityBroker` for true **default-deny, per-host**
enforcement. `CapabilityGate` (`src/runtime/governance/capability-gate.ts`)
seeds a grant whose resources are exactly the configured host allowlist, then
routes the tool's execution through `CapabilityBroker.execute`: the broker
materializes a grant for `(ssh.exec, <host>)` and throws `Capability denied` for
any host not covered. Wired in `ElliottRuntime.#installCapabilityGates`
(applied _before_ the governor, so a call produces a layered trail:
`tool.invocation` → `broker.dispatch` → real SSH → `broker.result` →
`tool.result`).

**Behavior-preserving:** the granted resources equal the SSH skill's own
allowlist (`settings.ssh.hosts`), so every host the skill would run also passes
the broker; a non-allowlisted host is denied one layer earlier (and audited as
`broker.dispatch`) and still rejected by the skill's own guard — defense in
depth, no regression. Tests: `test/unit/capability-gate.test.ts`.

## Prompt-injection benchmark for self-evolution

A self-modifying agent must never _evolve away_ its own injection resistance, and
the evolution engine must not be steered into promoting an artifact that is
itself an injection payload. A native, deterministic benchmark
(`src/learning/evolution/benchmarks/prompt-injection.ts` + `-corpus.ts`) scans an
evolution candidate's materialized artifact for injection / safety-bypass
signatures (ignore-previous-instructions, disregard-safety, exfiltrate-secrets,
trust-untrusted-content, developer-jailbreak, …) and fails the candidate if any
match. It runs in-process (no external companion), is prepended to the recurring
benchmark ladder (`continuous/benchmark.ts`) so it short-circuits promotion
before the expensive HTTP benchmarks, and `makePromptInjectionStage` is exported
for the pre-promotion plan too. Tests:
`test/unit/evolution/prompt-injection.test.ts`.

## Deliberately out of scope (documented next steps)

- **Corpus breadth.** The injection corpus is a starting signature set, not the
  toolkit's full benchmark. Broadening it (and folding in the toolkit's public
  corpus) is incremental — add patterns to `prompt-injection-corpus.ts`.
- **Result durability under crash.** `tool.result` records are `observational`
  and flush on cross-link/stop; a crash mid-turn can lose buffered results. The
  security-relevant `tool.invocation` and denial records are `effect-gating`
  (durable immediately).
