import { beforeEach, describe, expect, it } from "bun:test";
import { Aggregator } from "../../../skills/deep-trace/src/aggregator";
import type { DbSnapshot } from "../../../skills/deep-trace/src/types";
import type { TelemetryEnvelope } from "../../../src/runtime/types";
import { FakeTelemetryBus, mapMeta, resetSeq } from "./helpers";

const MAX_EVENTS = 400;
const MAX_TURNS = 60;

const makeStarted = (): { aggregator: Aggregator; bus: FakeTelemetryBus; } => {
  const bus = new FakeTelemetryBus();
  const aggregator = new Aggregator(mapMeta);
  aggregator.start(bus);
  return { aggregator, bus };
};

beforeEach(resetSeq);

describe("Aggregator snapshot", () => {
  it("returns meta verbatim, an ISO generatedAt, and an empty db before any tail tick", () => {
    const { aggregator } = makeStarted();
    const snapshot = aggregator.snapshot();
    expect(snapshot.meta).toEqual(mapMeta);
    expect(new Date(snapshot.generatedAt).toString()).not.toBe("Invalid Date");
    expect(snapshot.db).toEqual({ at: "", tables: [], recent: {} });
    expect(snapshot.turns).toEqual([]);
    expect(snapshot.events).toEqual([]);
  });

  it("reflects the latest db snapshot set via setDb", () => {
    const { aggregator } = makeStarted();
    const db: DbSnapshot = {
      at: "2026-01-01T00:00:00.000Z",
      tables: [{ table: "runs", count: 3, delta: 1 }],
      recent: { runs: [{ id: "r1" }] },
    };
    aggregator.setDb(db);
    expect(aggregator.snapshot().db).toEqual(db);
  });

  it("keeps a copy of ingested events in arrival order", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit("heartbeat", {});
    bus.emit("db.write", { table: "runs", count: 1, delta: 1 });
    const events = aggregator.snapshot().events;
    expect(events.map((event) => event.type)).toEqual([
      "heartbeat",
      "db.write",
    ]);
  });

  it("bounds the event window to the most recent 400 events", () => {
    const { aggregator, bus } = makeStarted();
    for (let index = 0; index < MAX_EVENTS + 25; index += 1) {
      bus.emit("heartbeat", { index });
    }
    const events = aggregator.snapshot().events;
    expect(events.length).toBe(MAX_EVENTS);
    expect(events[0]?.payload["index"]).toBe(25);
    expect(events.at(-1)?.payload["index"]).toBe(MAX_EVENTS + 24);
  });
});

describe("Aggregator turn tracking", () => {
  it("groups events by runId and ignores events without one", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit("inbound", { gateway: "slack" }, "run-1");
    bus.emit("heartbeat", {});
    bus.emit("turn.finish", { disposition: "answered" }, "run-1");
    expect(aggregator.turn("run-1").events.length).toBe(2);
    expect(aggregator.snapshot().turns.length).toBe(1);
    expect(aggregator.health()["events"]).toBe(3);
  });

  it("returns an empty detail for an unknown runId", () => {
    const { aggregator } = makeStarted();
    expect(aggregator.turn("missing")).toEqual({
      runId: "missing",
      events: [],
    });
  });

  it("orders turns by first appearance and evicts the oldest past 60", () => {
    const { aggregator, bus } = makeStarted();
    for (let index = 0; index < MAX_TURNS + 5; index += 1) {
      bus.emit("turn.begin", {}, `run-${index}`);
    }
    const turns = aggregator.snapshot().turns;
    expect(turns.length).toBe(MAX_TURNS);
    expect(turns[0]?.runId).toBe("run-5");
    expect(turns.at(-1)?.runId).toBe(`run-${MAX_TURNS + 4}`);
    expect(aggregator.turn("run-0").events).toEqual([]);
  });

  it("summarizes a full turn lifecycle into the run summary", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit(
      "inbound",
      {
        gateway: "slack",
        sender: "nick",
        channel: "#feed",
        text: "what changed today?",
      },
      "run-1",
    );
    bus.emit("turn.begin", { conversation: "conv-1" }, "run-1");
    bus.emit("model.request", { round: 1 }, "run-1");
    bus.emit("model.selection", { routeDigest: "digest-1" }, "run-1");
    bus.emit("tool.progress", { status: "in_progress" }, "run-1");
    bus.emit("tool.progress", { status: "complete" }, "run-1");
    bus.emit("tool.progress", { status: "error" }, "run-1");
    bus.emit("model.request", { round: 2 }, "run-1");
    bus.emit("turn.finish", { disposition: "answered" }, "run-1");
    const [summary] = aggregator.snapshot().turns;
    expect(summary).toMatchObject({
      runId: "run-1",
      gateway: "slack",
      sender: "nick",
      channel: "#feed",
      text: "what changed today?",
      conversation: "conv-1",
      rounds: 2,
      tools: 1,
      toolErrors: 1,
      routeDigest: "digest-1",
      disposition: "answered",
    });
    expect(summary?.startedAt).toBeDefined();
    expect(summary?.finishedAt).toBeDefined();
    expect(summary?.startedAt).not.toBe(summary?.finishedAt);
  });

  it("ignores non-string payload values in summaries", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit("inbound", { gateway: 42, sender: null, channel: ["x"] }, "run-1");
    const [summary] = aggregator.snapshot().turns;
    expect(summary?.gateway).toBeUndefined();
    expect(summary?.sender).toBeUndefined();
    expect(summary?.channel).toBeUndefined();
  });

  it("counts only complete tool progress as tools and error as toolErrors", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit("tool.progress", { status: "in_progress" }, "run-1");
    bus.emit("tool.progress", { status: "in_progress" }, "run-1");
    const [summary] = aggregator.snapshot().turns;
    expect(summary?.tools).toBe(0);
    expect(summary?.toolErrors).toBe(0);
  });
});

describe("Aggregator bus lifecycle", () => {
  it("replays the bus backlog on start before subscribing", () => {
    const bus = new FakeTelemetryBus();
    bus.emit("inbound", { gateway: "slack" }, "run-old");
    const aggregator = new Aggregator(mapMeta);
    aggregator.start(bus);
    expect(aggregator.turn("run-old").events.length).toBe(1);
    bus.emit("turn.finish", {}, "run-old");
    expect(aggregator.turn("run-old").events.length).toBe(2);
  });

  it("stops receiving events after stop()", () => {
    const { aggregator, bus } = makeStarted();
    aggregator.stop();
    bus.emit("heartbeat", {});
    expect(aggregator.snapshot().events).toEqual([]);
    expect(bus.subscribers.size).toBe(0);
  });

  it("tolerates stop() before start()", () => {
    const aggregator = new Aggregator(mapMeta);
    expect(() => {
      aggregator.stop();
    }).not.toThrow();
  });
});

describe("Aggregator client fan-out", () => {
  it("delivers each ingested event to every registered client", () => {
    const { aggregator, bus } = makeStarted();
    const seenA: TelemetryEnvelope[] = [];
    const seenB: TelemetryEnvelope[] = [];
    aggregator.addClient((event) => seenA.push(event));
    aggregator.addClient((event) => seenB.push(event));
    bus.emit("heartbeat", {});
    expect(seenA.length).toBe(1);
    expect(seenB.length).toBe(1);
    expect(seenA[0]?.type).toBe("heartbeat");
  });

  it("stops delivering to a client after its remove function runs", () => {
    const { aggregator, bus } = makeStarted();
    const seen: TelemetryEnvelope[] = [];
    const remove = aggregator.addClient((event) => seen.push(event));
    bus.emit("heartbeat", {});
    remove();
    bus.emit("heartbeat", {});
    expect(seen.length).toBe(1);
  });

  it("isolates a throwing client so ingestion and other clients continue", () => {
    const { aggregator, bus } = makeStarted();
    const seen: TelemetryEnvelope[] = [];
    aggregator.addClient(() => {
      throw new Error("dead stream");
    });
    aggregator.addClient((event) => seen.push(event));
    bus.emit("heartbeat", {});
    expect(seen.length).toBe(1);
    expect(aggregator.snapshot().events.length).toBe(1);
  });

  it("clears clients on stop()", () => {
    const { aggregator } = makeStarted();
    aggregator.addClient(() => {});
    aggregator.stop();
    expect(aggregator.health()["clients"]).toBe(0);
  });
});

describe("Aggregator health", () => {
  it("reports turns, events, clients, and dbTables counts", () => {
    const { aggregator, bus } = makeStarted();
    bus.emit("turn.begin", {}, "run-1");
    bus.emit("heartbeat", {});
    aggregator.addClient(() => {});
    aggregator.setDb({
      at: "2026-01-01T00:00:00.000Z",
      tables: [
        { table: "runs", count: 1, delta: 0 },
        { table: "messages", count: 2, delta: 0 },
      ],
      recent: {},
    });
    expect(aggregator.health()).toEqual({
      turns: 1,
      events: 2,
      clients: 1,
      dbTables: 2,
    });
  });
});
