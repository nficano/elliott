import { describe, expect, it } from "bun:test";
import {
  buildSentryEnvelope,
  parseDsn,
  sentryAuthHeader,
} from "../../../skills/glitchtip/src/envelope";
import type { TransmittableError } from "../../../src/runtime/types";

const error: TransmittableError = {
  name: "TypeError",
  frames: ["at handleTurn (/app/loop.ts:10:5)", "at run (/app/main.ts:3:1)"],
  mechanism: "turn",
  timestamp: "2026-08-01T00:00:00.000Z",
};

const input = {
  error,
  environment: "production",
  release: "1.2.3",
  eventId: "abc123",
};

describe("buildSentryEnvelope", () => {
  it("emits three newline-joined JSON lines", () => {
    expect(buildSentryEnvelope(input).split("\n")).toHaveLength(3);
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

  it("writes the event payload with the error class, frames, and mechanism — no message", () => {
    const lines = buildSentryEnvelope(input).split("\n");
    expect(JSON.parse(lines[2] ?? "")).toEqual({
      event_id: "abc123",
      timestamp: "2026-08-01T00:00:00.000Z",
      platform: "javascript",
      environment: "production",
      release: "1.2.3",
      level: "error",
      exception: {
        values: [{
          type: "TypeError",
          value: "(message withheld off-box; see local logs)",
          stacktrace: {
            frames: [
              { function: "at handleTurn (/app/loop.ts:10:5)" },
              { function: "at run (/app/main.ts:3:1)" },
            ],
          },
        }],
      },
      tags: { mechanism: "turn" },
    });
  });

  it("carries the error class name through to exception.values.type", () => {
    const lines = buildSentryEnvelope({
      ...input,
      error: { ...error, name: "RangeError" },
    }).split("\n");
    const payload: {
      exception: { values: { type: string; }[]; };
    } = JSON.parse(lines[2] ?? "");
    expect(payload.exception.values[0]?.type).toBe("RangeError");
  });

  it("has no message field to build from, so a message secret cannot appear", () => {
    // TransmittableError has no message; there is nowhere for an interpolated
    // secret to enter the envelope, so the builder needs no redaction.
    const body = buildSentryEnvelope(input);
    expect(body).not.toContain("supersecretpublickey");
    // The builder does not even accept a message; the frames are code locations.
    expect(body).toContain("handleTurn");
  });
});

describe("parseDsn", () => {
  it("splits a DSN into its envelope endpoint and public key", () => {
    expect(parseDsn("https://pubkey@collector.example:9000/7")).toEqual({
      publicKey: "pubkey",
      endpoint: "https://collector.example:9000/api/7/envelope/",
    });
  });

  it("handles a DSN with a base path before the project id", () => {
    expect(parseDsn("http://k@host/base/42")).toEqual({
      publicKey: "k",
      endpoint: "http://host/base/api/42/envelope/",
    });
  });

  it("rejects a DSN with no public key without echoing the DSN", () => {
    try {
      parseDsn("https://collector.example/7");
      throw new Error("expected parseDsn to throw");
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : String(error_);
      expect(message).toBe("GlitchTip DSN is invalid");
      expect(message).not.toContain("collector.example");
    }
  });
});

describe("sentryAuthHeader", () => {
  it("names the protocol version and public key", () => {
    expect(sentryAuthHeader("pubkey")).toBe(
      "Sentry sentry_version=7, sentry_key=pubkey",
    );
  });
});
