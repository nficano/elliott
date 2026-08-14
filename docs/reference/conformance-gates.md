# Conformance gates

One gate per design invariant, one file each, under
[`test/conformance/`](../../test/conformance/). They run as part of `bun test`.

These encode the design. Weakening one to make a change pass is a change to the
design, not to a test.

| Gate | File | Invariant |
| :--- | :--- | :--- |
| G1 | `g01-kind-integrity.test.ts` | kind integrity |
| G2 | `g02-residency-consistency.test.ts` | residency consistency |
| G3 | `g03-manifest-runtime.test.ts` | manifest and runtime contract agree |
| G4 | `g04-isolation-placement.test.ts` | isolation floors and placement |
| G5 | `g05-org-pinning.test.ts` | org pinning |
| G6 | `g06-grant-revocation.test.ts` | grant resolution and revocation |
| G7 | `g07-memory-classification.test.ts` | memory classification round-trip |
| G8 | `g08-profile-completeness.test.ts` | model profile completeness |
| G9, G10 | `g09-g10-routing.test.ts` | fail-closed routing |
| G11 | `g11-selection-audit.test.ts` | model selection audit |
| G12 | `g12-broker-integrity.test.ts` | broker integrity |
| G13 | `g13-prompt-cache.test.ts` | prompt-cache stability and residency |
| G14 | `g14-sanitizer-governance.test.ts` | sanitizer governance |
| G15 | `g15-sanitizer-audit.test.ts` | sanitizer audit and oracle resistance |
| G16 | `g16-audit-integrity.test.ts` | audit integrity |
| G17 | `g17-epoch-coherence.test.ts` | epoch coherence |
| G18 | `g18-route-equivalence.test.ts` | route-table equivalence |
| G19 | `g19-sanitizer-cache.test.ts` | sanitizer cache soundness |
| G20 | `g20-audit-durability.test.ts` | audit durability ordering |
| G21 | `g21-topology-container.test.ts` | residency probe and topology attestation |
| G22 | `g22-posture-monotonicity.test.ts` | posture monotonicity bookkeeping |
| G23 | `g23-secret-stream-containment.test.ts` | secret and streamed-argument containment |
| G24 | `g24-gateway-ingress.test.ts` | gateway ingress discipline |
| G25 | `g25-scheduler-authority.test.ts` | scheduler authority freshness |
| G26 | `g26-agent-governance.test.ts` | agent governance |
| G27 | `g27-secret-reference-enforcement.test.ts` | secret-bearing config fields are opaque references |

G9 and G10 share one file. Twenty-six invariants, twenty-five `g*` files.

## Self-evolution gates

| File | Covers |
| :--- | :--- |
| `se-evolution.test.ts` | evolution conformance |
| `se-evolution-evaluation.test.ts` | evaluation conformance |

## Adding one

A new invariant gets a new `test/conformance/g<N>-<slug>.test.ts` whose
`describe` string opens with the gate id. Conformance tests assert contracts
rather than implementations; read the existing files for tone before writing
one.

G21 checks [`deploy/compose.yml`](../../deploy/compose.yml), which describes the
isolated container topology.

G26 doubles as the OWASP Agentic Top-10 checklist for the controls described in
[Governance](../explanation/governance.md).

G27 is the executable form of the secrets doctrine (CLAUDE.md: "Secrets are
opaque references … resolved at the config boundary"). A config field is
secret-bearing by ROLE — its key's final word (`token`, `secret`, `password`,
`passphrase`, `dsn`, `key`, `credential`) — so the check covers `llm.api_key`,
`store.dsn`, the Slack tokens, `browser.token`, every `config/secrets.yaml`
entry, AND a credential field a skill adds under the `skills.*` passthrough, with
no enumerated path list to fall behind. G27 asserts that a literal in any such
field is a load-time error naming the field without echoing the value; that a
`${ENV:…}`/`${VAULT:…}` reference resolves; and that a field naming a
`config/secrets.yaml` entry (the indirection pattern — recognised structurally,
the value is a declared secrets key) is accepted.

G27 is best-effort EARLY rejection, and the gate claims nothing more. Deciding
which field holds a credential from its key is inference: it covers the role
words above in either `snake_case` or `camelCase`, plus a declared set of
credential fields whose names carry no role word (`authorization`, `cookie`,
`session`, `access_url`, `webhook_url`), but a skill may call its credential
field anything — `auth`, `bearer`, something bespoke — and the config boundary
has no manifest to consult, because config loads before skills do. A literal in
such a field is not rejected. The complete close is manifest-declared secret
fields, which would require the loader to read manifests before resolving config;
it is not implemented (see [Known issues](known-issues.md)).

**Containment does not rest on G27.** What keeps a missed credential out of
operator-facing output is the output side: the doctor never forwards untrusted
text — a skill's `register()` error, an agent-local manifest's name, gate, or
secret references, an endpoint's response body — and prints only facts it
derived, so there is nothing to scrub and nothing for a name the role test missed
to ride out on. G27's value is failing a bad config early and loudly, not
containing a leak.
