# Testing strategy

The suites here are shaped around one uncomfortable property of the runtime: a
skill that fails to register does not crash anything.

## The failure the other suites missed

Unit tests are strong and the conformance gates encode the design. Neither
caught the failures most likely to break production:

- A `register()` throwing under real settings. `SkillContext.report` swallows
  the throw, the runtime boots degraded, nothing notices.
- A tool whose `inputSchema` drifts until the model stops being able to call it.
- A tool whose `execute` builds a malformed request or misparses a real
  response.
- A gateway that accepts an inbound message and never replies.
- A route or service that mounts and then 500s, or never ticks.

None of the pre-existing tests exercised a skill through the real ingress path.
`test/unit/bundled-skills.test.ts` asserted every catalog entry ships a package
with a `register` function, which is necessary and nowhere near sufficient.

## The lever

Every skill is reached through exactly one contract:

```ts
register(context: SkillContext): SkillRegistration
// → { tools?, gateways?, routes?, services?, facilities? }
```

and the runtime loads them all through `loadBundledPackages` into
`loadSkillRegistrations`. Because the seam is uniform, one harness can load
every skill the way `app.ts` does and then exercise each binding kind
generically. That uniformity is worth protecting; it is what makes the whole
strategy cheap.

## Three tiers

| Tier | Dependencies | Runs | Proves |
| :--- | :--- | :--- | :--- |
| 0, registration and contract | none | every push | every skill registers under real settings; schemas, routes, and services are well-formed |
| 1, skill logic | fakes at egress | every push | each binding does its job on a happy path and one error path |
| 2, true end-to-end | real or recorded third parties | gated lane | the full path works against reality |

Tiers 0 and 1 are the CI safety net: fast, deterministic, no secrets. Tier 2 is
the confidence lane, and it needs credentials and a test account.

Tier 0 and the Tier-1 harnesses have landed in `test/integration/skills/`. Tier
2 remains a proposal.

## Why Tier 0 earns its keep

One test builds a fully-populated fixture `RuntimeSettings`, with every optional
block filled with well-typed dummy values so every settings-gated skill
registers, then runs the real loader with a `report` spy and asserts that
`report()` fired zero times.

That single assertion converts "skill silently failed to register" from an
invisible production degrade into a red check. Everything else in that file is
cheap by comparison: the loaded count matches the implemented count, no two
skills claim a tool name, every `inputSchema` is a valid JSON-Schema object,
every route has a unique method and path, every service has `start` and `stop`.

The tool-count snapshot is deliberate friction. Adding or removing a tool means
editing a number in a diff, which makes the change reviewed instead of silent.

## Stub at the narrowest seam

Tier 1 replaces dependencies as close to the boundary as possible. HTTP tools
get `fixtures.stubFetch` at the global fetch boundary, asserting the request
built and parsing a canned response. Filesystem tools get no stub at all: they
run against a `mkdtemp` sandbox root, and the error path asserts confinement,
because a `../` escape being rejected is the entire reason the tool has a root.

Stubbing further in would test the stub. Stubbing further out would need the
network.

## The posture matrix, and what it does not yet prove

The intent is sound. `standard` should execute the same code paths vacuously,
which is the property that makes raising a posture safe, and a test passing in
only one posture would signal that enforcement leaked into semantics.

The wiring is not there. CI sets `ELLIOTT_POSTURE` per matrix job and no code
reads it; the kernel takes posture as a constructor argument defaulting to
`standard`. All three jobs run identical paths today.

This is worth stating plainly rather than leaving as an implied guarantee. A
green matrix is not evidence a change behaves under `regulated`. Threading the
variable through to `AgentKernel` would make it evidence.

## Conformance gates are a different genre

`test/conformance/` holds one gate per design invariant. They assert contracts,
not implementations, and they are the model for tone elsewhere. A new invariant
gets a new gate file.

They are also, now, the only place the invariants are written down. Read the
index at [Conformance gates](../reference/conformance-gates.md) before assuming
a design claim is enforced.

## House rules

Deterministic and offline. Network goes through cassettes, time is explicit.
Test the contract rather than the implementation. New code carries tests that
keep the coverage aggregate at or above the floors, and the floors move up only.
