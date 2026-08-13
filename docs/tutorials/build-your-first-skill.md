# Build your first skill

In this tutorial we will build a complete skill from an empty directory: a
`dice` tool the model can call to roll dice. We will write four files, prove the
skill loads with a test, and watch the tool appear in a booted runtime.

You do not need to know anything about the skill system. Every file appears here
in full. Finish [Run your first agent](run-your-first-agent.md) first, since we
boot the runtime at the end.

## Step 1: Make the directory

A skill is a directory holding a manifest and the code that manifest declares:

```bash
mkdir -p skills/dice/src
```

We are working in the framework tree because you have it checked out. Skills
that belong to one specific agent live in that agent's own repository under
`agents/<name>/skills/`, and the format is identical. See
[Framework skills vs. agent skills](../explanation/framework-vs-agent-repos.md)
once you are done here.

## Step 2: Write the manifest

Create `skills/dice/manifest.yaml`:

```yaml
apiVersion: elliott/v1
kind: tool
profile: tool-standard
metadata: { namespace: core, name: dice, version: 1.0.0 }
spec:
  document: SKILL.md
  protocols: [tool.executor]
  capabilities: []
  egress: { class: none }
  isolation: container
  exports:
    - { ref: tool/dice, implementation: src/index.ts }
```

Two lines here carry the weight.

`capabilities: []` with `egress: { class: none }` says this skill asks for
nothing. It computes locally and never opens a socket. A skill that needs the
network has to say so: open `skills/fetch/manifest.yaml` and you will find
`network.connect` spelled out with the hosts it may reach.

`exports` is what makes the code run at all. Drop that block and you have a
descriptor the loader reads and never imports. Discovery is manifest-first, and
nothing executes until a manifest says it should.

## Step 3: Write the kind document

Create `skills/dice/SKILL.md`:

```markdown
---
name: dice
description: Roll dice with a configurable number of sides.
---

# dice

Rolls `count` dice with `sides` sides and returns the individual rolls and
their total. Pure computation, no capabilities requested.
```

The model reads this description when it decides whether to call your tool.
Write it for that reader.

## Step 4: Write register()

Create `skills/dice/src/index.ts`:

```typescript
import type { SkillRegistration } from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";

const MAX_DICE = 20;
const MAX_SIDES = 1000;

export const register = (): SkillRegistration => ({
  tools: [diceTool()],
});

const diceTool = (): ToolDefinition => ({
  name: "roll_dice",
  description: "Roll `count` dice with `sides` sides each. "
    + "Returns the individual rolls and their sum.",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 1, maximum: MAX_DICE },
      sides: { type: "integer", minimum: 2, maximum: MAX_SIDES },
    },
    required: ["count", "sides"],
  },
  execute: async (input) => {
    const count = clamp(Number(input["count"]), 1, MAX_DICE);
    const sides = clamp(Number(input["sides"]), 2, MAX_SIDES);
    const rolls = Array.from(
      { length: count },
      () => 1 + Math.floor(Math.random() * sides),
    );
    return JSON.stringify({
      rolls,
      total: rolls.reduce((sum, roll) => sum + roll, 0),
    });
  },
});

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Math.trunc(value)));
```

Three things to notice.

The `clamp` call re-validates input that `inputSchema` already describes. The
schema tells the model what to send. It does not stop the model from sending
something else, so you check.

`execute` returns a string. That string comes back into the loop wrapped as
untrusted evidence, never as instructions, which means your tool cannot talk the
agent into doing something by putting words in its output.

The `../../../src/` import depth matches a package sitting at `skills/dice/`.
A package at `agents/<name>/skills/dice/` imports from the `elliott/skills` and
`elliott/runtime` package exports instead.

## Step 5: Prove it loads

A skill whose `register()` throws does not crash the boot. The runtime reports
it and carries on degraded, which means a broken skill is invisible in
production unless a test catches it. So we write the test.

Create `test/integration/skills/dice-smoke.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

describe("dice skill (Tier 0/1)", () => {
  it("registers and rolls within bounds", async () => {
    const { context } = await makeSmokeContext();
    const dice = toolByName(await loadOneSkill("dice", context), "roll_dice");

    const result = JSON.parse(await dice.execute({ count: 3, sides: 6 }));
    expect(result.rolls).toHaveLength(3);
    for (const roll of result.rolls) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
    expect(result.total).toBe(
      result.rolls.reduce((sum: number, roll: number) => sum + roll, 0),
    );
  });
});
```

Run it:

```bash
bun test test/integration/skills/dice-smoke.test.ts
```

One passing test. The suite now fails if anyone breaks your manifest, your
export path, or your bounds.

## Step 6: Boot and find it

```bash
bun run dev
```

In a second shell:

```bash
curl -s localhost:8080/healthz
```

The tool count went up by one. `roll_dice` is now in the set offered to the
model, and every call to it passes through the governance chokepoint on the way:
policy check, principal attribution, a digest-only record in the audit log. You
wrote none of that. It is the runtime's job, and it happens to your skill
whether or not you thought about it.

## What you built

A four-file skill that registers, computes, and ships with a test.

- The manifest declares authority. The code implements behavior. The loader
  reads the first before running the second.
- Capabilities start empty and fail closed.
- Registration failures are silent by design, so every skill carries a smoke
  test.

## Next

- Give a skill infrastructure from another skill:
  [Consume a facility](../guides/consume-a-facility.md)
- The full `register()` contract, all five binding kinds:
  [SkillContext reference](../reference/api/skill-context.md)
- Why the loader is shaped like this:
  [The security model](../explanation/security-model.md)
