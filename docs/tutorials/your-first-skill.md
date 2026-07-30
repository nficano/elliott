# Tutorial: your first skill

In this tutorial you build a complete Elliott skill from scratch — a `dice`
tool the agent can call to roll dice — and prove it works with a smoke test.
No prior knowledge of the skill system is assumed; every file is written out
in full.

**Where skills live.** Skills that are specific to *your* agent belong in
your agent repository under `agents/<name>/skills/` — the loader treats them
identically to the framework-bundled packages in `skills/` (see
[Framework skills vs. agent skills](../explanation/agent-skills.md)). The
package format below is the same in both places. For this tutorial, work in
whichever tree you have checked out.

## 1. Create the package directory

A skill is a directory containing an authority manifest and the code it
declares:

```
skills/dice/
├── manifest.yaml    # what this skill is and may do — read before any code runs
├── SKILL.md         # the standard kind document (human-readable description)
└── src/
    └── index.ts     # the executable module the manifest exports
```

```bash
mkdir -p skills/dice/src
```

## 2. Write the manifest

Discovery is manifest-first: the loader reads `manifest.yaml` and registers
nothing unless the manifest declares an export. Our tool computes locally,
touches no network, and needs no capabilities:

```yaml
# skills/dice/manifest.yaml
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

Two lines carry the security weight:

- `capabilities: []` and `egress: { class: none }` — this skill asks for
  nothing. A skill that needs the network must *declare* it (compare
  `skills/fetch/manifest.yaml`, which requests `network.connect`).
- `exports` — without it the package is descriptor-only and no code loads.

Every field is documented in the
[manifest reference](../reference/api/manifest.md).

## 3. Write the kind document

```markdown
<!-- skills/dice/SKILL.md -->
---
name: dice
description: Roll dice with a configurable number of sides.
---

# dice

Rolls `count` dice with `sides` sides and returns the individual rolls and
their total. Pure computation; no capabilities requested.
```

## 4. Write `register()`

The implementation exports a single function, `register`, which receives a
`SkillContext` and returns bindings. A tool binding is a name, a
description the model reads, a JSON-Schema input contract, and an `execute`
function that returns a string:

```typescript
// skills/dice/src/index.ts
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

Things to notice:

- **Inputs are clamped, not trusted.** The model supplies `input`; validate
  every field even though `inputSchema` describes the contract.
- **Output is a string** (here, JSON). Tool output is treated as untrusted
  evidence by the loop — never as instructions.
- The relative import depth (`../../../src/...`) matches a package at
  `skills/dice/`; adjust if yours sits at `agents/<name>/skills/dice/`.

The full seam — all five binding kinds, facilities, `context.settings` —
is in the [`register()` reference](../reference/api/skill-context.md).

## 5. Prove it loads: a smoke test

Registration failures are deliberately non-fatal (the runtime boots
degraded), so an unloadable skill is *silent* in production. The Tier-0
smoke suite exists to catch exactly that. Add one:

```typescript
// test/integration/skills/dice-smoke.test.ts
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

## 6. Boot and see it

```bash
bun run dev
```

At boot the two-pass loader reads every `manifest.yaml`, registers facility
providers first, then calls your `register()`. `roll_dice` is now part of
the tool set offered to the model, and — like every tool — its calls pass
through the governance chokepoint (policy, principal attribution, audit
record). You did not have to do anything for that; it is the platform's
job, not the skill's.

## What you learned

- A skill = `manifest.yaml` (authority) + kind document + an exported
  `register()` (bindings).
- Capabilities are declared, empty by default, and fail closed.
- Smoke tests are the guardrail against silently-degraded boots.

## Next

- Recipes for real tasks: [How-to guides](../index.md#how-to-guides)
- The exact contracts you just used:
  [Reference](../index.md#reference)
- Why the loader behaves this way:
  [Design decisions](../explanation/design-decisions.md)
