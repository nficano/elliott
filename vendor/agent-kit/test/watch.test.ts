import { describe, expect, test } from "bun:test";
import { rotating, taskForDate } from "../src/host/scheduler/rota.js";
import { diffSnapshots } from "../src/skills/watch/diff.js";
import {
  measureOutcomes,
  recordOutcome,
} from "../src/skills/watch/outcomes.js";
import { makeMemoryWatchStore } from "../src/skills/watch/store.js";
import type { WatchSnapshot } from "../src/skills/watch/store.js";
import { decaying, splitAttribution } from "../src/skills/watch/trend.js";

const snap = (date: string, rows: WatchSnapshot["rows"]): WatchSnapshot => ({
  date,
  rows,
});
const row = (id: string, series: string, metrics: Record<string, number>) => ({
  id,
  series,
  metrics,
});

describe("watch diff (TDD §9.2)", () => {
  const opts = {
    metric: "rank",
    direction: "down-good" as const,
    moveThreshold: 2,
    activityMetric: "clicks",
    actNowMin: 5,
  };

  test("direction-aware moves, entered/exited, act-now floor", () => {
    const prev = snap("2026-07-14", [
      row("k1", "/a", { rank: 8, clicks: 10 }),
      row("k2", "/b", { rank: 4, clicks: 1 }),
      row("k3", "/c", { rank: 12, clicks: 0 }),
    ]);
    const cur = snap("2026-07-21", [
      row("k1", "/a", { rank: 14, clicks: 9 }), // worse by 6, active → act now
      row("k2", "/b", { rank: 9, clicks: 1 }), // worse by 5, quiet
      row("k4", "/d", { rank: 3, clicks: 2 }), // new
    ]);
    const d = diffSnapshots(cur, prev, opts);
    expect(d.declined.map((c) => c.id)).toEqual(["k1", "k2"]);
    expect(d.actNow.map((c) => c.id)).toEqual(["k1"]);
    expect(d.entered.map((r) => r.id)).toEqual(["k4"]);
    expect(d.exited.map((r) => r.id)).toEqual(["k3"]);
  });

  test("same id on two series never collides; sub-threshold wobble is ignored", () => {
    const prev = snap("d1", [
      row("k", "/a", { rank: 5, clicks: 0 }),
      row("k", "/b", { rank: 20, clicks: 0 }),
    ]);
    const cur = snap("d2", [
      row("k", "/a", { rank: 6, clicks: 0 }),
      row("k", "/b", { rank: 10, clicks: 0 }),
    ]);
    const d = diffSnapshots(cur, prev, opts);
    expect(d.improved).toHaveLength(1); // only /b's 10-place climb; /a's 1-place wobble ignored
    expect(d.improved[0]!.series).toBe("/b");
  });
});

describe("watch trend", () => {
  test("decaying: sustained wrong-way slide amid activity; short histories excluded", () => {
    const history = [
      snap("d1", [
        row("k1", "/a", { rank: 4, clicks: 10 }),
        row("k2", "/b", { rank: 3, clicks: 10 }),
      ]),
      snap("d2", [
        row("k1", "/a", { rank: 6, clicks: 9 }),
        row("k2", "/b", { rank: 3, clicks: 10 }),
      ]),
      snap("d3", [row("k1", "/a", { rank: 9, clicks: 8 })]),
    ];
    const out = decaying(history, {
      metric: "rank",
      direction: "down-good",
      weightMetric: "clicks",
      activityMetric: "clicks",
      activityMin: 1,
      slideThreshold: 2,
    });
    expect(out.map((s) => s.series)).toEqual(["/a"]); // /b: only 2 points and no slide
    expect(out[0]!.slide).toBeCloseTo(5);
  });

  test("splitAttribution: secondary series counts only above share + weight floors", () => {
    const rows = [
      row("k", "/a", { w: 80 }),
      row("k", "/b", { w: 40 }), // 33% share, weight 40 → counts
      row("k", "/c", { w: 2 }), // tiny → dropped
      row("solo", "/x", { w: 100 }),
    ];
    const out = splitAttribution(rows, {
      weightMetric: "w",
      shareMin: 0.25,
      weightMin: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.series.map((s) => s.series)).toEqual(["/a", "/b"]);
  });
});

describe("watch outcomes", () => {
  const now = new Date("2026-07-21T12:00:00Z");

  test("record replaces same kind+subject+day and caps the ledger", () => {
    let ledger = recordOutcome([], {
      kind: "fix",
      subject: "/a",
      baseline: { rank: 8 },
      now,
    });
    ledger = recordOutcome(ledger, {
      kind: "fix",
      subject: "/a",
      baseline: { rank: 9 },
      now,
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.baseline.rank).toBe(9);
  });

  test("soak → verdicts; young records soak; ancient records retire", async () => {
    const at = (daysAgo: number) =>
      new Date(now.getTime() - daysAgo * 86_400_000);
    let ledger = recordOutcome([], {
      kind: "fix",
      subject: "improved",
      baseline: { rank: 10, clicks: 10 },
      now: at(30),
    });
    ledger = recordOutcome(ledger, {
      kind: "fix",
      subject: "declined",
      baseline: { rank: 5, clicks: 10 },
      now: at(30),
    });
    ledger = recordOutcome(ledger, {
      kind: "fix",
      subject: "young",
      baseline: { rank: 5 },
      now: at(3),
    });
    ledger = recordOutcome(ledger, {
      kind: "fix",
      subject: "ancient",
      baseline: { rank: 5 },
      now: at(200),
    });

    const current: Record<string, Record<string, number>> = {
      improved: { rank: 4, clicks: 14 },
      declined: { rank: 9, clicks: 6 },
    };
    const report = await measureOutcomes(
      ledger,
      async (r) => current[r.subject] ?? null,
      {
        metric: "rank",
        direction: "down-good",
        activityMetric: "clicks",
        now,
      },
    );
    expect(report.retiredCount).toBe(1);
    expect(report.soaking.map((r) => r.subject)).toEqual(["young"]);
    const verdicts = Object.fromEntries(
      report.measured.map((m) => [m.record.subject, m.verdict]),
    );
    expect(verdicts).toEqual({ improved: "improved", declined: "declined" });
  });
});

describe("memory watch store", () => {
  test("previous/history/retention", async () => {
    const store = makeMemoryWatchStore(3);
    for (const d of ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]) {
      await store.save("k", snap(d, []));
    }
    expect((await store.history("k", "2026-12-31", 10)).map((s) => s.date))
      .toEqual([
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
      ]); // retention 3 dropped the oldest
    expect((await store.previous("k", "2026-01-15"))?.date).toBe("2026-01-08");
    expect(await store.previous("k", "2026-01-01")).toBeNull();
  });
});

describe("scheduler rota", () => {
  const plan = {
    1: { task: { title: "monday", prompt: "m" } },
    2: {
      alternate: [
        { title: "even", prompt: "e" },
        { title: "odd", prompt: "o" },
      ] as const,
    },
  };

  test("weekday map, weekend null, alternates flip weekly", () => {
    expect(taskForDate(plan, new Date("2026-07-20T12:00:00Z"))?.title).toBe(
      "monday",
    ); // Mon
    expect(taskForDate(plan, new Date("2026-07-19T12:00:00Z"))).toBeNull(); // Sun
    expect(taskForDate(plan, new Date("2026-07-22T12:00:00Z"))).toBeNull(); // Wed, no slot
    const a = taskForDate(plan, new Date("2026-07-21T12:00:00Z"))?.title; // Tue
    const b = taskForDate(plan, new Date("2026-07-28T12:00:00Z"))?.title; // next Tue
    expect(new Set([a, b])).toEqual(new Set(["even", "odd"]));
  });

  test("rotating covers the list across weeks", () => {
    const list = ["a", "b", "c"];
    const picks = [0, 7, 14].map((days) =>
      rotating(list, new Date(Date.UTC(2026, 6, 20 + days)))
    );
    expect(new Set(picks)).toEqual(new Set(list));
  });
});
