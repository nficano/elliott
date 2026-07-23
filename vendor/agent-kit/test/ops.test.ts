import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ToolCtx, ToolDef } from "../src/core/agent/types.js";
import type { ServiceGet } from "../src/core/di/services.js";
import type { CapabilityInvoker } from "../src/host/capabilities/bus.js";
import { CapabilityError } from "../src/host/capabilities/errors.js";
import { makeCooldown, makeSeenSet } from "../src/skills/ops/hygiene.js";
import { isSelfReference } from "../src/skills/ops/self-guard.js";
import { spikeWatchSkill } from "../src/skills/ops/skills.js";
import {
  correlateChange,
  markSeen,
  selectSpikes,
} from "../src/skills/ops/spike.js";

/** No runtime services in this unit test; the skill under test never reaches for one. */
const noServices: ServiceGet = (tag) => {
  throw new Error(`test: no service ${tag.key}`);
};

const item = (
  key: string,
  count: number,
  extra: Record<string, unknown> = {},
) => ({
  key,
  title: `title ${key}`,
  count,
  ...extra,
});

describe("spike selection (TDD §9.3)", () => {
  test("floor + seen + ignore + self are all applied; quiet items are NOT marked seen", () => {
    const now = () => 1_000_000;
    const seen = makeSeenSet({ ttlMs: 86_400_000, now });
    seen.add("old");
    const items = [
      item("old", 50),
      item("fresh", 30),
      item("quiet", 3),
      { ...item("noisy", 40), title: "Timeout waiting for X" },
      item("mine", 60, { project: "main" }),
    ];
    const spikes = selectSpikes(items, {
      minCount: 20,
      seen,
      ignoreSubstrings: ["timeout waiting"],
      isSelf: (i) =>
        isSelfReference({ projectSlug: "main" }, {
          ...(i.project && { project: i.project }),
        }),
    });
    expect(spikes.map((s) => s.key)).toEqual(["fresh"]);

    markSeen(items, { minCount: 20, seen });
    expect(seen.has("quiet")).toBe(false); // may still alert when it grows
    expect(seen.has("noisy")).toBe(true);
  });

  test("correlateChange: most recent successful change inside the window, before the spike", () => {
    const changes = [
      { ref: "r1", title: "deploy 1", at: "2026-07-21T10:00:00Z", ok: true },
      { ref: "r2", title: "deploy 2", at: "2026-07-21T11:30:00Z", ok: true },
      { ref: "r3", title: "failed", at: "2026-07-21T11:50:00Z", ok: false },
      { ref: "r4", title: "after", at: "2026-07-21T13:00:00Z", ok: true },
    ];
    const hit = correlateChange("2026-07-21T12:00:00Z", changes, 60 * 60_000);
    expect(hit?.ref).toBe("r2");
    expect(
      correlateChange("2026-07-21T12:00:00Z", changes.slice(0, 1), 60 * 60_000),
    ).toBeNull();
    expect(correlateChange(undefined, changes, 60 * 60_000)).toBeNull();
  });
});

describe("hygiene", () => {
  test("seen set TTL-expires and bounds size oldest-first", () => {
    let t = 0;
    const seen = makeSeenSet({ ttlMs: 100, max: 2, now: () => t });
    seen.add("a");
    t = 50;
    seen.add("b");
    seen.add("c"); // over max → 'a' (oldest) evicted
    expect(seen.has("a")).toBe(false);
    expect(seen.has("b")).toBe(true);
    t = 200;
    expect(seen.has("b")).toBe(false); // TTL
  });

  test("cooldown windows", () => {
    let t = 0;
    const cd = makeCooldown({ windowMs: 100, now: () => t });
    expect(cd.active("k")).toBe(false);
    cd.touch("k");
    t = 99;
    expect(cd.active("k")).toBe(true);
    t = 101;
    expect(cd.active("k")).toBe(false);
  });
});

describe("self-guard", () => {
  const identity = { projectSlug: "dan", projectId: "4509" };
  test("strong signals match; a free-text name mention does not", () => {
    expect(isSelfReference(identity, { shortId: "DAN-1A2" })).toBe(true);
    expect(isSelfReference(identity, { project: "Dan" })).toBe(true);
    expect(
      isSelfReference(identity, {
        url: "https://errors.example/issues/4509/x",
      }),
    ).toBe(true);
    expect(isSelfReference(identity, { shortId: "WEB-9" })).toBe(false);
    // The word "dan" in a title is NOT a signal — there's no title signal at all.
    expect(isSelfReference(identity, {})).toBe(false);
  });
});

describe("spike-watch skill (null-vs-empty + baseline)", () => {
  function activateWith(
    feedResults: (unknown | Error)[],
  ): Promise<ReturnType<typeof callTool>> {
    const queue = [...feedResults];
    const caps: CapabilityInvoker = {
      available: () => false,
      invoke: (ref) => {
        if (ref !== "issue-feed@1") {
          return Effect.fail(
            new CapabilityError({ reason: "unknown", detail: ref, chain: [] }),
          );
        }
        const next = queue.shift();
        if (next instanceof Error) {
          return Effect.fail(
            new CapabilityError({
              reason: "failed",
              detail: next.message,
              chain: [],
            }),
          );
        }
        return Effect.succeed(next);
      },
    };
    const skill = spikeWatchSkill({ now: () => 1_000_000 });
    return Schema.decodeUnknownPromise(skill.manifest.configSchema)({
      enabled: true,
      min_count: 10,
    })
      .then((config) =>
        skill.activate({
          config,
          get: noServices,
          tier: "fast",
          profile: {},
          secrets: {},
          caps,
        })
      )
      .then((active) => callTool(active.tools![0]!));
  }

  const toolCtx: ToolCtx = {
    traceId: "t",
    sessionId: "s",
    conversationKey: "c",
    origin: "internal",
  };
  function callTool(tool: Pick<ToolDef, "execute">) {
    return () =>
      Effect.runPromise(
        tool.execute({}, toolCtx).pipe(
          Effect.match({
            onSuccess: (s) => JSON.parse(s) as Record<string, unknown>,
            onFailure: (e) => ({ threw: String(e) }),
          }),
        ),
      );
  }

  test("first success seeds baseline; failed fetch never advances state; then fresh spikes flow", async () => {
    const run = await activateWith([
      { items: [item("a", 50)] }, // 1: baseline — 'a' seen, nothing fresh
      new Error("feed down"), // 2: degrade, no state change
      { items: null }, // 3: fetch failed → skipped, no state change
      { items: [item("a", 60), item("b", 40)] }, // 4: only 'b' is fresh
    ]);
    expect((await run()).baseline).toBe(true);
    expect((await run()).mode).toBe("failed"); // degradeForModel of the bus error
    expect((await run()).skipped).toContain("state untouched");
    const fresh = (await run()).fresh as { key: string; }[];
    expect(fresh.map((f) => f.key)).toEqual(["b"]);
  });
});
