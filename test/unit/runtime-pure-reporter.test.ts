import { describe, expect, it, spyOn } from "bun:test";
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
