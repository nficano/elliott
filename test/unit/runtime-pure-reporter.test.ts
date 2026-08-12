import { describe, expect, it, spyOn } from "bun:test";
import { makeRedactor } from "../../src/runtime/redaction";
import { RuntimeErrorReporter } from "../../src/runtime/reporter";
import type { CapturedError } from "../../src/runtime/types";

// The reporter is now neutral: console baseline + optional, isolated sinks, and
// no Sentry/DSN/transport knowledge. These tests pin that contract.

describe("RuntimeErrorReporter", () => {
  it("logs every capture to the console with the mechanism", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      new RuntimeErrorReporter().capture(new Error("boom"), "turn");
      expect(errorSpy).toHaveBeenCalledWith("[turn] boom");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("is console-only with no sink installed", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // No throw, no transport — the baseline path when glitchtip is disabled.
      expect(() =>
        new RuntimeErrorReporter().capture("plain string failure", "boot")
      ).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("forwards a normalized, secret-free CapturedError to each sink", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const seen: CapturedError[] = [];
    try {
      const reporter = new RuntimeErrorReporter();
      reporter.addSink({ capture: (event) => seen.push(event) });
      reporter.addSink({ capture: (event) => seen.push(event) });
      reporter.capture(new TypeError("no host"), "gateway:slack");
    } finally {
      errorSpy.mockRestore();
    }
    expect(seen).toHaveLength(2);
    const [event] = seen;
    expect(event?.name).toBe("TypeError");
    expect(event?.message).toBe("no host");
    expect(event?.mechanism).toBe("gateway:slack");
    expect(typeof event?.timestamp).toBe("string");
    // The event carries only these four keys — no settings, DSN, or token can
    // ride along because none are ever put on it.
    expect(Object.keys(event ?? {}).sort((a, b) => a.localeCompare(b))).toEqual(
      [
        "mechanism",
        "message",
        "name",
        "timestamp",
      ],
    );
  });

  it("redacts secrets from a message before the console line and sinks", () => {
    const logged: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });
    const seen: CapturedError[] = [];
    try {
      // Seeded with the exact configured values the runtime would pass in.
      const reporter = new RuntimeErrorReporter(
        makeRedactor([
          "http://elliott@127.0.0.1:9080/1",
          "hvs.LEAKYTOKEN",
          "secret/data/private",
        ]),
      );
      reporter.addSink({ capture: (event) => seen.push(event) });
      reporter.capture(
        new Error(
          "Vault read of secret/data/private with hvs.LEAKYTOKEN failed (500)",
        ),
        "turn",
      );
    } finally {
      errorSpy.mockRestore();
    }
    const [event] = seen;
    expect(event?.message).not.toContain("hvs.LEAKYTOKEN");
    expect(event?.message).not.toContain("secret/data/private");
    // The non-secret context survives so the error is still useful.
    expect(event?.message).toContain("Vault read of");
    expect(event?.message).toContain("failed (500)");
    // The console line the runtime emitted is redacted too.
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain("hvs.LEAKYTOKEN");
    expect(logged[0]).not.toContain("secret/data/private");
  });

  it("redacts the mechanism too (console line and sink event)", () => {
    const logged: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });
    const seen: CapturedError[] = [];
    try {
      const reporter = new RuntimeErrorReporter(
        makeRedactor(["hvs.SECRETMECHANISM"]),
      );
      reporter.addSink({ capture: (event) => seen.push(event) });
      reporter.capture(new Error("safe"), "hvs.SECRETMECHANISM");
    } finally {
      errorSpy.mockRestore();
    }
    expect(seen[0]?.mechanism).not.toContain("hvs.SECRETMECHANISM");
    expect(logged[0]).not.toContain("hvs.SECRETMECHANISM");
  });

  it("isolates a throwing sink so one bad sink never breaks the loop", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const delivered: string[] = [];
    try {
      const reporter = new RuntimeErrorReporter();
      reporter.addSink({
        capture: () => {
          throw new Error("sink is broken");
        },
      });
      reporter.addSink({ capture: (event) => delivered.push(event.message) });
      expect(() => reporter.capture(new Error("real"), "turn")).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
    // The healthy sink still received the event after the broken one threw.
    expect(delivered).toEqual(["real"]);
  });
});
