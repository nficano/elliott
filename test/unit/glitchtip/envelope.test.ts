import { describe, expect, it } from "bun:test";
import {
  buildSentryEnvelope,
  parseDsn,
  sentryAuthHeader,
} from "../../../skills/glitchtip/src/envelope";
import type { CapturedError } from "../../../src/runtime/types";

const error: CapturedError = {
  name: "TypeError",
  message: "boom",
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
      error: { ...error, name: "RangeError", message: "no host" },
    }).split("\n");
    const payload: {
      exception: { values: { type: string; value: string; }[]; };
    } = JSON.parse(lines[2] ?? "");
    expect(payload.exception.values[0]).toEqual({
      type: "RangeError",
      value: "no host",
    });
  });

  it("puts no DSN, public key, or token in the payload body", () => {
    // The builder only ever sees a CapturedError plus environment/release, so a
    // secret cannot appear even if one is passed alongside it.
    const body = buildSentryEnvelope(input);
    expect(body).not.toContain("supersecretpublickey");
    expect(body).not.toContain("hvs.");
  });

  it("pattern-redacts a credential embedded in the message as a last defense", () => {
    // Even if a CapturedError reached the builder un-redacted (the reporter is
    // the primary, seeded redaction point), credential-shaped substrings are
    // stripped before the wire. This is the adversary's direct-builder repro.
    const body = buildSentryEnvelope({
      ...input,
      error: {
        ...error,
        message:
          "call to https://leakykey@sentry.example/1 with hvs.LEAKYTOKEN",
      },
    });
    expect(body).not.toContain("hvs.LEAKYTOKEN");
    expect(body).not.toContain("leakykey");
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
