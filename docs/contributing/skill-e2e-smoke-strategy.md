# Skill E2E & Smoke Test Strategy

Status: Tier 0 landed (test/integration/skills/); Tiers 1-2 remain proposals

## Problem

Elliott ships 25 implemented skills (31 tools, 2 socket gateways, 35 HTTP
routes, 4 background services). Current test coverage is strong on *units*
(`test/unit/*`) and *invariants* (`test/conformance/g01–g25`), and there is one
structural manifest test (`test/unit/bundled-skills.test.ts`) that asserts every
catalog entry ships a package with a `register` function.

What we have **no** coverage for is the thing most likely to break in
production:

- A skill's `register()` throwing under real settings (silently swallowed by
  `SkillContext.report` — the runtime boots degraded, no test catches it).
- A tool whose `inputSchema` drifts so the model can no longer call it.
- A tool's `execute()` building a malformed request or mis-parsing a real
  provider response.
- A gateway that accepts an inbound message but never produces an outbound
  reply.
- A route/service that mounts but 500s or never ticks.

None of the existing tests exercise a skill through the **real ingress path**
(`RuntimeAgent.turn` → tool dispatch, or `GatewayEvents.onMessage` → reply, or
an HTTP request to the mounted route). That is the gap this strategy closes.

## The lever: one uniform seam

Every implemented skill is reached through exactly one contract:

```ts
register(context: SkillContext): SkillRegistration
// → { tools?, gateways?, routes?, services? }
```

and the runtime loads them all through `loadBundledPackages` →
`loadSkillRegistrations` (`src/runtime/skills/loader.ts`). Because the seam is
uniform, a **single harness** can load every skill the way `app.ts` does, then
exercise each binding type generically. This is already proven — the
deep-trace e2e harness (`skills/deep-trace/e2e/harness.ts`) hand-builds a
`SkillContext` and drives the real registration. A throwaway probe that ran the
*whole* catalog this way loaded 25/25 skills with 0 `report()` errors and 0
schema problems, confirming the approach generalizes.

## Three tiers

| Tier | Name | Deps | Runs | Proves |
|------|------|------|------|--------|
| 0 | Registration & contract smoke | none (hermetic) | every push, in `bun test` | every skill registers under real settings; schemas/routes/services are well-formed |
| 1 | Skill-logic smoke (boundary-stubbed) | fakes at egress | every push, in `bun test` | each tool/gateway/route/service does its *own* job on a happy path + one error path |
| 2 | True end-to-end | real (or recorded) third parties + real runtime | gated lane (nightly / pre-deploy) + post-deploy canary | the full path works against reality: model sees & calls the tool, gateway round-trips, route serves live data |

Tiers 0 and 1 are the CI safety net (fast, deterministic, no secrets). Tier 2
is the confidence lane (slow, gated, needs credentials and a test account).

---

## Tier 0 — Registration & contract smoke (hermetic)

A single new test file, e.g. `test/smoke/skill-contract.test.ts`, that:

1. Builds a **fully-populated fixture `RuntimeSettings`** (every optional
   settings block filled with dummy-but-well-typed values) so every
   settings-gated skill actually registers. Populate: `browser`, `slack`,
   `gmail`, `bluebubbles`, `files`, `terminal`, `ssh`, `smtp`, `homeAssistant`,
   `cloudflared`, `webhookSecret`, `braveApiKey`, `firecrawlApiKey`,
   `parallelApiKey`, `newsBrief`, `pakman`, `youtubeDvr`, `mcp`.
2. Runs the **real** `loadBundledPackages(root)` +
   `loadSkillRegistrations(...)` with a `report` spy.
3. Asserts:
   - `report()` fired **0 times** (any register-time throw is a failure, not a
     silent degrade).
   - Loaded skill count == implemented count == `IMPLEMENTED` list.
   - `collectTools` does not throw (no duplicate tool names) and total tool
     count matches an expected snapshot (guards accidental add/remove).
   - Every tool `inputSchema` is `{ type: "object", ... }` and JSON-Schema
     valid.
   - Every route has a unique `method+path` and a `handle` fn (no two skills
     claim the same route — the runtime does exact match and first-wins).
   - Every service exposes `start`/`stop`; `health()` returns a flat
     `Record<string, number>`.
   - `health()` shape after a full boot matches `RuntimeHealth`.

This is the cheapest, highest-value addition: it turns "skill silently failed
to register" from an invisible prod degrade into a red CI check. It is also the
right home for the counts snapshot (31 tools / 2 gateways / 35 routes / 4
services today) so schema/wiring drift is caught by diff.

---

## Tier 1 — Skill-logic smoke (boundary-stubbed)

For each binding type, exercise the skill's own logic once on a happy path and
once on a representative error, with external dependencies replaced by fakes at
the **narrowest** seam.

### Choke points for stubbing

- **HTTP tools** (fetch, search-brave, web-firecrawl, web-parallel,
  home-assistant, pakman, gmail): the shared helper
  `src/runtime/skills/http.ts` `request()` is the single HTTP choke point for
  most of these. Stub it (or inject a `fetch` double) and assert the tool
  issues the right request and parses a canned response. Recorded response
  fixtures ("cassettes") keep these deterministic.
- **Filesystem tools** (files, terminal): no stub needed — run for real against
  a `mkdtemp` sandbox root. These are the cheapest true tests; assert path
  confinement (a `../` escape must be rejected) as the error path.
- **Slack gateway**: already has `test/unit/slack-gateway.test.ts`; extend it to
  drive `GatewayEvents.onMessage` with a synthetic owner message and assert a
  `send()` (recorded by a fake transport) fires.
- **Webhook/route skills**: build a `Request` and call `route.handle(req,
  events)` directly; assert status + that inbound events are enqueued.
- **Services** (news-brief, scheduler, youtube-dvr): call `start()`, force one
  tick (inject a clock or call the internal poll), assert `health()` counters
  increment and the side effect (`deliver`/job-fire) is observed via the
  `SkillContext.deliver` spy. Then `stop()` cleanly.
- **MCP client**: point at an in-process fake MCP server (stdio/http) and assert
  tool discovery + one call round-trips.

### Per-skill matrix

| Skill | Kind | Tier-1 seam | Happy path | Error path |
|-------|------|-------------|-----------|-----------|
| fetch | tool | stub `request` | fetch → stripped text | non-public URL rejected |
| files | tool | real tmp root | write/read/list | `../` escape rejected |
| terminal | tool | real tmp root | run allowed cmd | disallowed cmd rejected |
| ssh | tool | stub ssh transport | exec returns stdout | host not in allowlist |
| search-duckduckgo | tool | stub `request` | parse results (unit exists) | malformed html → [] |
| search-brave | tool | stub `request` | parse results | missing key / 401 |
| web-firecrawl | tool | stub `request` | scrape/crawl parse | 4xx surfaced |
| web-parallel | tool | stub `request` | search parse | 4xx surfaced |
| pakman-latest-episode | tool | stub `request` | latest ep resolved | auth failure |
| gateway-gmail (5 tools) | tool | stub `request` | list/get/send shape | recipient not allowed |
| gateway-home-assistant (3) | tool | stub `request` | state/service call | bad entity |
| browser (2 tools) | tool | stub CDP/http | navigate/extract | domain not allowed |
| news-brief | service | forced tick + deliver spy | brief delivered above threshold | source fetch error handled |
| scheduler (3 tools + svc) | tool+svc | fake clock | schedule → fire → deliver | bad cron rejected |
| youtube-dvr | tool+svc | stub YouTube API | poll → playlist add | oauth refresh failure |
| gateway-slack | gateway | fake transport | onMessage → send | non-owner dropped |
| gateway-bluebubbles/email/webhook | gateway | fake transport / Request | inbound → reply | sender not allowlisted |
| deep-trace | route+svc | real Bun.serve loopback | `/state` serves live pack | (covered by 77+24 existing) |
| mcp-client | mcp | in-proc fake server | discover + call | server down handled |

Prompt-only skills (code-review, debugging, research) and evaluators register
nothing executable — Tier 0's document/manifest check is their full coverage.

---

## Tier 2 — True end-to-end

"True" means: the **real runtime**, the **real ingress**, and **real
dependencies** (or faithfully recorded ones), asserting **real side effects**.

### 2a. Tool-through-the-model (the only test that proves callability)

Boot `ElliottRuntime` (or `RuntimeAgent` directly) against a **loopback LiteLLM
proxy** and run a real `agent.turn(conversation, prompt)` with a prompt
engineered to force one specific tool call. Assert via `TurnObserver`:

- `onModelSelection` fired (router chose a route),
- `onToolProgress` shows the target tool `complete` (not `error`),
- the final answer reflects the tool result.

This is the **only** tier that proves the live model can actually see and
invoke a tool with its current schema — a class of failure invisible to Tiers
0/1. Run one representative tool per family (a read-only one: `fetch_url`,
`web_search`, a `files` read, a home-assistant state read) to keep it cheap.

### 2b. Gateway round-trip

Deliver a synthetic `InboundMessage` through the real `GatewayEvents.onMessage`
seam (exactly what `app.ts` wires) with a fake outbound transport, and assert an
outbound `send()` with a non-empty answer. Note (from ops memory): Slack inbound
is owner-gated (`event.user === ownerId`), so a *real* inbound Slack round-trip
can only be driven by Nick messaging Elliott; the harness path covers everything
except the socket delivery itself.

### 2c. Route e2e

Real HTTP `GET`/`POST` against the booted server: `/healthz`,
`/v1/observability/map` (+ its 34 asset routes), `/v1/components`, and the
webhook route with a signed payload.

### 2d. Live post-deploy canary (deploy gate)

Reuse the verification muscle from the consumer's deploy pipeline:

- After the `/healthz` gate, assert the health JSON's `skills`/`tools` counts
  equal the expected snapshot (catches "deployed image is missing a skill").
- Run **one** scripted turn per tool-family inside the container via the
  established `docker exec -i elliott sh -c 'cat > /tmp/x.ts && bun /tmp/x.ts'`
  trick (rootfs is read-only; stdin into tmpfs). Import
  `src/runtime/config.ts` + `skills/loader.ts`, load a skill, call
  `tool.execute()` against the real environment. Read-only tools only.
- Post pass/fail to Slack `#feed` alongside the existing release announce.

### Handling destructive & credentialed dependencies

Tier 2 must never spam or mutate real systems:

- **Send-capable skills** (bluebubbles, gmail send, slack post, ssh, terminal):
  gate behind a dedicated **test account / sandbox recipient allowlist** and a
  `SMOKE_DRY_RUN` flag; default CI runs the read-only subset only.
- **Rate-limited paid APIs** (brave, firecrawl, parallel): use recorded
  cassettes in the nightly lane; hit the live API only in a weekly "freshness"
  run that detects provider-side contract drift.
- **Credentials**: sourced the same way deploy does — Vault (`elliott-deploy`
  AppRole reads the configured secrets path), never checked into the repo.

---

## CI wiring

- **Every push** (existing `bun test` matrix in `.github/workflows/ci.yml`):
  Tier 0 + Tier 1. Fully hermetic, no secrets, sub-second per skill. Gates the
  `deploy` job.
- **Nightly gated lane**: Tier 2a–2c against loopback model + recorded
  cassettes. No prod side effects.
- **Post-deploy canary**: Tier 2d, right after the `/healthz` gate in
  the consumer's deploy pipeline; failure pages the alerts channel.
- **Weekly freshness**: live third-party calls (read-only) to catch upstream
  contract drift, decoupled from deploys so a provider outage can't block a
  release.

## Rollout order

1. ✅ **Tier 0** — `test/integration/skills/contract-smoke.test.ts`. No fakes;
   turns silent register-time degrades into red CI.
2. ✅ **Tier 1 for FS tools** — `files-terminal-smoke.test.ts` (real tmp root:
   write/read/list round-trip, path-escape + allowlist rejection).
3. ✅ **Tier 1 HTTP-tool cassettes** — `fixtures.stubFetch` spies the global
   fetch boundary; `http-tools-smoke.test.ts` covers fetch/brave/duckduckgo
   happy + SSRF-guard + upstream-5xx paths. Every remaining HTTP tool
   (firecrawl, parallel, gmail, home-assistant, pakman) reuses `stubFetch`.
4. ✅ **Tier 1 gateway/service/route** — `webhook-route-smoke.test.ts` drives
   the route+events ingress seam (signed→202→`onMessage`; bad-sig 401;
   malformed 400; oversized 413) via the `makeGatewayEvents` recorder;
   `scheduler-service-smoke.test.ts` covers the tool round-trip against the real
   store + validation errors + service start/stop lifecycle. Generalizes to the
   other route/service skills.
5. **Tier 2a** loopback-model callability for one tool per family.
6. **Tier 2d** deploy canary — extend the consumer's deploy pipeline.
7. **Tier 2b/2c + nightly/weekly lanes.**

Steps 1–4 are landed: `test/integration/skills/` (7 files, 18 tests), all
hermetic, in the default `bun test` run, lint/format/typecheck clean. Remaining
Tier-1 coverage (other HTTP tools, other gateways/services) is now mechanical —
copy the matching harness helper (`stubFetch`, `makeGatewayEvents`,
`loadOneSkill`). The next non-mechanical step is Tier 2a (loopback model).

## Success criteria

- A skill that fails to register, drops a tool, or drifts a schema turns CI red
  before merge.
- Every send/mutate path has an allowlist + dry-run guard so no test can spam a
  real inbox/phone.
- A deploy that ships a degraded skill set fails the canary before it announces.
- Counts (skills/tools/routes/services) are snapshotted so adds/removals are
  reviewed, not silent.
