# Skill E2E & Smoke Test Strategy

Status: Tier 0 and the Tier-1 harnesses landed (`test/integration/skills/`);
Tier 2 remains a proposal. The strategy covers every skill source the loader
knows: bundled `skills/`, installed registry skills, and agent-repo skills.
Registry and agent repos run the same tiers against their own packages; the
examples here use the bundled set.

## Problem

Unit suites (`test/unit/*`) and conformance gates (`test/conformance/*`) are
strong, and `test/unit/bundled-skills.test.ts` asserts every catalog entry
ships a package with a `register` function. Nothing covered the failures most
likely to break production:

- A skill's `register()` throwing under real settings. `SkillContext.report`
  swallows the throw, the runtime boots degraded, and no test notices.
- A tool whose `inputSchema` drifts until the model can no longer call it.
- A tool's `execute()` building a malformed request or mis-parsing a real
  provider response.
- A gateway that accepts an inbound message but never produces a reply.
- A route or service that mounts but 500s or never ticks.

None of the pre-existing tests exercised a skill through the real ingress path
(`RuntimeAgent.turn` → tool dispatch, `GatewayEvents.onMessage` → reply, or an
HTTP request to the mounted route). This strategy closes that gap.

## The lever: one uniform seam

Every skill is reached through exactly one contract:

```ts
register(context: SkillContext): SkillRegistration
// → { tools?, gateways?, routes?, services?, facilities? }
```

and the runtime loads them all through `loadBundledPackages` →
`loadSkillRegistrations` (`src/runtime/skills/loader.ts`). Because the seam is
uniform, a single harness can load every skill the way `app.ts` does, then
exercise each binding kind generically.

## Three tiers

| Tier | Name | Deps | Runs | Proves |
|------|------|------|------|--------|
| 0 | Registration & contract smoke | none (hermetic) | every push, in `bun test` | every skill registers under real settings; schemas/routes/services are well-formed |
| 1 | Skill-logic smoke (boundary-stubbed) | fakes at egress | every push, in `bun test` | each tool/gateway/route/service does its own job on a happy path + one error path |
| 2 | True end-to-end | real (or recorded) third parties + real runtime | gated lane (nightly / pre-deploy) + post-deploy canary | the full path works against reality: model sees & calls the tool, gateway round-trips, route serves live data |

Tiers 0 and 1 are the CI safety net: fast, deterministic, no secrets. Tier 2
is the confidence lane: slow, gated, needs credentials and a test account.

## Tier 0 — Registration & contract smoke (hermetic)

One test (`test/integration/skills/contract-smoke.test.ts`) that:

1. Builds a fully-populated fixture `RuntimeSettings` (every optional settings
   block filled with dummy-but-well-typed values) so every settings-gated
   skill registers.
2. Runs the real `loadBundledPackages(root)` + `loadSkillRegistrations(...)`
   with a `report` spy.
3. Asserts:
   - `report()` fired zero times. A register-time throw is a failure, not a
     silent degrade.
   - Loaded skill count equals the implemented count.
   - `collectTools` does not throw (no duplicate tool names) and the total
     tool count matches an expected snapshot.
   - Every tool `inputSchema` is `{ type: "object", … }` and JSON-Schema
     valid.
   - Every route has a unique `method+path` and a `handle` fn. The runtime
     does exact match, first-wins.
   - Every service exposes `start`/`stop`; `health()` returns a flat
     `Record<string, number>` matching `RuntimeHealth`.

This is the cheapest, highest-value tier: it turns "skill silently failed to
register" from an invisible production degrade into a red CI check, and the
counts snapshot makes adds/removals reviewed rather than silent.

## Tier 1 — Skill-logic smoke (boundary-stubbed)

Exercise each skill's own logic once on a happy path and once on a
representative error, with external dependencies replaced at the narrowest
seam:

- **HTTP tools**: `fixtures.stubFetch` spies the global fetch boundary.
  Assert the tool issues the right request and parses a canned response;
  recorded fixtures keep it deterministic.
- **Filesystem tools** (`files`, `terminal`): no stub. Run against a
  `mkdtemp` sandbox root; the error path asserts confinement (a `../` escape
  must be rejected, a disallowed command refused).
- **Gateways**: drive `GatewayEvents.onMessage` with a synthetic inbound
  message and a fake outbound transport; assert a `send()` fires and a
  non-allowlisted sender is dropped.
- **Route skills**: build a `Request` and call `route.handle(req, events)`
  directly; assert status and that inbound events are enqueued.
- **Services** (`scheduler`): call `start()`, force one tick (inject a clock),
  assert `health()` counters increment and the side effect is observed via a
  `SkillContext.deliver` spy, then `stop()` cleanly.
- **MCP client**: point at an in-process fake MCP server and assert tool
  discovery plus one call round-trips.

Bundled-set examples:

| Skill | Kind | Tier-1 seam | Happy path | Error path |
|-------|------|-------------|-----------|-----------|
| fetch | tool | stubFetch | fetch → stripped text | non-public URL rejected |
| files | tool | real tmp root | write/read/list | `../` escape rejected |
| terminal | tool | real tmp root | run allowed cmd | disallowed cmd rejected |
| ssh | tool | stub ssh transport | exec returns stdout | host not in allowlist |
| scheduler | tool+svc | fake clock | schedule → fire → deliver | bad cron rejected |
| deep-trace | route+svc | real Bun.serve loopback | `/state` serves live pack | covered by its own suites |
| mcp-client | mcp | in-proc fake server | discover + call | server down handled |

Prompt-only skills and the evaluators register nothing executable; Tier 0's
manifest/document check is their full coverage. Registry skills reuse the same
harness helpers (`stubFetch`, `makeGatewayEvents`, `loadOneSkill`) in the
registry repo's suite.

## Tier 2 — True end-to-end

"True" means the real runtime, the real ingress, and real dependencies (or
faithfully recorded ones), asserting real side effects.

### 2a. Tool-through-the-model

Boot the runtime against a loopback OpenAI-compatible proxy and run a real
`agent.turn(conversation, prompt)` engineered to force one specific tool call.
Assert via `TurnObserver`: `onModelSelection` fired, `onToolProgress` shows
the target tool `complete`, and the final answer reflects the tool result.
This is the only tier that proves the live model can see and invoke a tool
with its current schema. Run one representative read-only tool per family to
keep it cheap.

### 2b. Gateway round-trip

Deliver a synthetic `InboundMessage` through the real
`GatewayEvents.onMessage` seam with a fake outbound transport; assert an
outbound `send()` with a non-empty answer.

### 2c. Route e2e

Real HTTP against the booted server: `/healthz`, `/v1/observability/map`,
`/v1/components`, and the webhook route with a signed payload.

### 2d. Post-deploy canary (deploy gate)

In the consumer repo's deploy pipeline, after the `/healthz` gate: assert the
health JSON's `skills`/`tools` counts equal the expected snapshot, then run
one scripted read-only turn per tool family inside the container. A deploy
that ships a degraded skill set fails before it announces.

### Destructive & credentialed dependencies

Tier 2 must never spam or mutate real systems:

- Send-capable skills gate behind a dedicated test account, a sandbox
  recipient allowlist, and a `SMOKE_DRY_RUN` flag; default CI runs the
  read-only subset only.
- Rate-limited paid APIs use recorded cassettes in the nightly lane and hit
  the live API only in a weekly freshness run that detects provider-side
  contract drift.
- Credentials come from the deployment's secret store, the same way deploy
  does. Nothing is checked into the repo.

## CI wiring

- **Every push** (the `bun test` matrix in CI): Tier 0 + Tier 1. Hermetic, no
  secrets.
- **Nightly gated lane**: Tier 2a–2c against a loopback model + cassettes.
- **Post-deploy canary**: Tier 2d in the consumer repo's pipeline.
- **Weekly freshness**: live read-only third-party calls, decoupled from
  deploys so a provider outage cannot block a release.

## Status

Landed, all hermetic, in the default `bun test` run:

1. **Tier 0** — `contract-smoke.test.ts`.
2. **Tier 1 FS tools** — `files-terminal-smoke.test.ts` (tmp-root round-trip,
   path-escape + allowlist rejection).
3. **Tier 1 HTTP tools** — `http-tools-smoke.test.ts` (happy + SSRF-guard +
   upstream-5xx paths via `stubFetch`).
4. **Tier 1 gateway/service/route** — `webhook-route-smoke.test.ts`
   (signed→202→`onMessage`; bad-sig 401; malformed 400; oversized 413) and
   `scheduler-service-smoke.test.ts` (tool round-trip, validation errors,
   service lifecycle).

Remaining Tier-1 coverage is mechanical: copy the matching harness helper.
The next non-mechanical step is Tier 2a.

## Success criteria

- A skill that fails to register, drops a tool, or drifts a schema turns CI
  red before merge.
- Every send/mutate path has an allowlist + dry-run guard so no test can spam
  a real inbox or phone.
- A deploy that ships a degraded skill set fails the canary before it
  announces.
- Counts (skills/tools/routes/services) are snapshotted so adds and removals
  are reviewed, not silent.
