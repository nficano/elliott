# How to write a skill smoke test

Every skill needs one. A `register()` that throws is reported and swallowed, the
runtime boots degraded, and nothing else notices. The smoke suite is what turns
that silent degrade into a red CI check.

Suites live in `test/integration/skills/`. Rationale and tier definitions:
[Testing strategy](../explanation/testing-strategy.md).

## Tier 0: prove it registers

`test/integration/skills/contract-smoke.test.ts` already covers every bundled
skill against a fully-populated fixture settings object. Adding a skill to
`skills/` puts it in that test automatically, and the test fails if:

- `report()` fires at all, meaning something threw during `register()`
- the loaded skill count drifts from the implemented count
- two skills claim the same tool name
- a tool's `inputSchema` is not a valid JSON-Schema object
- two routes share a `method` and `path`
- a service is missing `start` or `stop`

The tool-count snapshot in that file is deliberate. Adding or removing a tool
makes you update a number in a diff, which makes it reviewed rather than silent.

## Tier 1: prove it works

One happy path and one error path per binding, with dependencies stubbed at the
narrowest seam.

```typescript
import { describe, expect, it } from "bun:test";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

describe("my-skill (Tier 0/1)", () => {
  it("registers and returns what the model expects", async () => {
    const { context } = await makeSmokeContext();
    const tool = toolByName(await loadOneSkill("my-skill", context), "my_tool");

    expect(JSON.parse(await tool.execute({ query: "x" }))).toMatchObject({
      ok: true,
    });
  });
});
```

Pick the stub by what your skill touches:

| Skill talks to | Use |
| :--- | :--- |
| HTTP | `fixtures.stubFetch`, asserting the request it built and parsing a canned response |
| Filesystem | no stub; a `mkdtemp` sandbox root |
| A facility provider | a fake provider registered in the smoke context |

For filesystem tools, make the error path assert confinement. A `../` escape has
to be rejected and a disallowed command refused. That is the whole point of the
tool having a root.

## Run it

```bash
bun test test/integration/skills/my-skill-smoke.test.ts
bun test test/integration/skills/          # the whole smoke suite
```

## Keep it hermetic

Tiers 0 and 1 run on every push, so they take no secrets and open no sockets.
Network goes through recorded cassettes and time is explicit. Anything needing a
real credential or a live third party belongs in the gated Tier 2 lane, not
here.

## If your skill needs settings to register

`makeSmokeContext()` hands you the fixture settings. Override the block your
skill reads rather than adding a real secret:

```typescript
const { context } = await makeSmokeContext({
  tools: { ssh: { enabled: true, user: "test", hosts: ["example"] } },
});
```

A skill that stays dormant under fixture settings will stay dormant in the
contract smoke test too, and the count assertion will tell you.
