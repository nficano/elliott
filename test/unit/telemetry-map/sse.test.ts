import { beforeEach, describe, expect, it } from "bun:test";
import { Aggregator } from "../../../skills/telemetry-map/src/aggregator";
import { streamResponse } from "../../../skills/telemetry-map/src/sse";
import { envelope, FakeTelemetryBus, mapMeta, resetSeq } from "./helpers";

const decoder = new TextDecoder();

const makeStream = (): {
  aggregator: Aggregator;
  bus: FakeTelemetryBus;
  response: Response;
  reader: ReadableStreamDefaultReader<Uint8Array>;
} => {
  const bus = new FakeTelemetryBus();
  const aggregator = new Aggregator(mapMeta);
  aggregator.start(bus);
  const response = streamResponse(aggregator);
  const reader = response.body!.getReader();
  return { aggregator, bus, response, reader };
};

const readChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> => {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  return decoder.decode(value);
};

beforeEach(resetSeq);

describe("streamResponse headers", () => {
  it("responds as a no-cache keep-alive event stream", () => {
    const { response } = makeStream();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.headers.get("connection")).toBe("keep-alive");
  });
});

describe("streamResponse framing", () => {
  it("opens with the stream-open comment", async () => {
    const { reader } = makeStream();
    expect(await readChunk(reader)).toBe(": telemetry-map stream open\n\n");
  });

  it("frames each telemetry event as event: <type> plus JSON data", async () => {
    const { bus, reader } = makeStream();
    await readChunk(reader);
    bus.emit("model.selection", { routeDigest: "digest-1" }, "run-1");
    const frame = await readChunk(reader);
    const [eventLine, dataLine, blank] = frame.split("\n", 3);
    expect(eventLine).toBe("event: model.selection");
    expect(blank).toBe("");
    const parsed = JSON.parse((dataLine ?? "").replace("data: ", ""));
    expect(parsed).toMatchObject({
      type: "model.selection",
      runId: "run-1",
      payload: { routeDigest: "digest-1" },
    });
  });

  it("delivers every event in order to the same stream", async () => {
    const { bus, reader } = makeStream();
    await readChunk(reader);
    bus.emit("turn.begin", {}, "run-1");
    bus.emit("turn.finish", {}, "run-1");
    const first = await readChunk(reader);
    expect(first).toStartWith("event: turn.begin\n");
    const second = await readChunk(reader);
    expect(second).toStartWith("event: turn.finish\n");
  });
});

describe("streamResponse lifecycle", () => {
  it("registers exactly one aggregator client per stream", () => {
    const { aggregator } = makeStream();
    expect(aggregator.health()["clients"]).toBe(1);
  });

  it("removes its aggregator client when the consumer cancels", async () => {
    const { aggregator, reader } = makeStream();
    await reader.cancel();
    expect(aggregator.health()["clients"]).toBe(0);
  });

  it("keeps ingestion alive after cancellation", async () => {
    const { aggregator, bus, reader } = makeStream();
    await reader.cancel();
    bus.emit("heartbeat", {});
    expect(aggregator.snapshot().events.length).toBe(1);
  });

  it("supports multiple concurrent stream clients", async () => {
    const bus = new FakeTelemetryBus();
    const aggregator = new Aggregator(mapMeta);
    aggregator.start(bus);
    const readerA = streamResponse(aggregator).body!.getReader();
    const readerB = streamResponse(aggregator).body!.getReader();
    expect(aggregator.health()["clients"]).toBe(2);
    await readChunk(readerA);
    await readChunk(readerB);
    bus.push(envelope("heartbeat", {}));
    expect(await readChunk(readerA)).toStartWith("event: heartbeat\n");
    expect(await readChunk(readerB)).toStartWith("event: heartbeat\n");
  });
});
