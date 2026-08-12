import { describe, expect, it } from "bun:test";
import { buildSentryEnvelope } from "../../src/runtime/reporter";

const input = {
  error: new TypeError("boom"),
  mechanism: "turn",
  environment: "production",
  release: "1.2.3",
  eventId: "abc123",
  timestamp: "2026-08-01T00:00:00.000Z",
};

describe("buildSentryEnvelope", () => {
  it("emits three newline-joined JSON lines", () => {
    const lines = buildSentryEnvelope(input).split("\n");
    expect(lines).toHaveLength(3);
  });

  it("writes the envelope header with the event id and sent_at timestamp", () => {
    const lines = buildSentryEnvelope(input).split("\n");
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      event_id: "abc123",
      sent_at: "2026-08-01T00:00:00.000Z",
    });
  });

  it("writes the item header identifying an event", () => {
    const lines = buildSentryEnvelope(input).split("\n");
    expect(JSON.parse(lines[1] ?? "")).toEqual({ type: "event" });
  });

  it("writes the event payload with exception, tags, and metadata", () => {
    const lines = buildSentryEnvelope(input).split("\n");
    expect(JSON.parse(lines[2] ?? "")).toEqual({
      event_id: "abc123",
      timestamp: "2026-08-01T00:00:00.000Z",
      platform: "javascript",
      environment: "production",
      release: "1.2.3",
      level: "error",
      exception: { values: [{ type: "TypeError", value: "boom" }] },
      tags: { mechanism: "turn" },
    });
  });

  it("carries the error name and message through to exception.values", () => {
    const lines = buildSentryEnvelope({
      ...input,
      error: new RangeError("no host"),
    })
      .split("\n");
    const payload: {
      exception: { values: { type: string; value: string; }[]; };
    } = JSON.parse(lines[2] ?? "");
    expect(payload.exception.values[0]).toEqual({
      type: "RangeError",
      value: "no host",
    });
  });
});
