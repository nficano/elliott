import { describe, expect, it, spyOn } from "bun:test";
import { RuntimeErrorReporter } from "../../src/runtime/reporter";
import type { TransmittableError } from "../../src/runtime/types";

// The reporter is neutral and enforces a STRUCTURAL secret boundary: it logs the
// full failure to the local console (allowed — does not leave the process) but
// hands each sink a TransmittableError that carries NO message, so nothing that
// could hold an interpolated secret is transmitted off-box. These tests pin that.

describe("RuntimeErrorReporter", () => {
  it("logs the full failure to the console with the mechanism", () => {
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

  it("hands each sink a message-free TransmittableError (name, frames, mechanism, timestamp)", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const seen: TransmittableError[] = [];
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
    expect(event?.mechanism).toBe("gateway:slack");
    expect(typeof event?.timestamp).toBe("string");
    expect(Array.isArray(event?.frames)).toBe(true);
    // Exactly these four keys — and crucially NO `message`, the one field that
    // could carry an interpolated secret.
    expect(Object.keys(event ?? {}).sort((a, b) => a.localeCompare(b))).toEqual(
      [
        "frames",
        "mechanism",
        "name",
        "timestamp",
      ],
    );
  });

  it("transmits no part of a secret interpolated into an exception message", () => {
    // Property test with NO pre-registered secret list: an unknown credential in
    // the message must not appear anywhere in what the sink receives — because
    // the message is never handed to a sink at all.
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secret = "unknowable-credential-9f83aa21c7";
    const seen: TransmittableError[] = [];
    try {
      const reporter = new RuntimeErrorReporter();
      reporter.addSink({ capture: (event) => seen.push(event) });
      reporter.capture(
        new Error(`upstream rejected token ${secret} on retry`),
        "turn",
      );
    } finally {
      errorSpy.mockRestore();
    }
    // Nothing the sink received contains any part of the secret.
    expect(JSON.stringify(seen[0])).not.toContain(secret);
    for (const frame of seen[0]?.frames ?? []) {
      expect(frame).not.toContain(secret);
    }
  });

  it("does not mistake a message line that looks like a stack frame for a real frame", () => {
    // A multiline message whose lines mimic frames (even with a fake source
    // location) is still the MESSAGE — it must not reach the transmitted frames.
    // No seeded list: the secret is unknown to the process.
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const secret = "hvs.multiline-frame-injection-4d7e";
    const seen: TransmittableError[] = [];
    try {
      const reporter = new RuntimeErrorReporter();
      reporter.addSink({ capture: (event) => seen.push(event) });
      for (
        const message of [
          `safe\n    at ${secret}`,
          `safe\n    at handler (${secret}:1:1)`,
          `failed at ${secret} while connecting`,
        ]
      ) {
        seen.length = 0;
        reporter.capture(new Error(message), "turn");
        expect(JSON.stringify(seen[0]?.frames)).not.toContain(secret);
        // Real frames still come through.
        expect((seen[0]?.frames ?? []).length).toBeGreaterThan(0);
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the full message on the local console (which does not leave the process)", () => {
    const logged: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });
    try {
      new RuntimeErrorReporter().capture(
        new Error("connect failed for host-42"),
        "gateway",
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(logged).toEqual(["[gateway] connect failed for host-42"]);
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
      reporter.addSink({ capture: (event) => delivered.push(event.name) });
      expect(() => reporter.capture(new TypeError("real"), "turn")).not
        .toThrow();
    } finally {
      errorSpy.mockRestore();
    }
    // The healthy sink still received the event after the broken one threw.
    expect(delivered).toEqual(["TypeError"]);
  });
});
