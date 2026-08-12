import type { CapturedError, ErrorSink } from "./types";

// Neutral, transport-agnostic error visibility. Every captured failure is
// logged to the console (the always-on baseline) and normalized to a
// CapturedError — name, message, mechanism, timestamp only, never settings or
// secrets — before being handed to each registered sink.
//
// Sinks are optional and isolated: a sink that throws never breaks the loop,
// and with no sink installed (e.g. the glitchtip skill disabled or absent)
// capture() is console-only. No sink transport — Sentry envelopes, DSNs, HTTP —
// lives here; that belongs to the skill that installs the sink, so the core
// runtime carries no error-reporting vendor code.
export class RuntimeErrorReporter {
  readonly #sinks: ErrorSink[] = [];

  addSink(sink: ErrorSink): void {
    this.#sinks.push(sink);
  }

  capture(error: unknown, mechanism: string): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    console.error(`[${mechanism}] ${failure.message}`);
    if (this.#sinks.length === 0) return;
    const event: CapturedError = {
      name: failure.name,
      message: failure.message,
      mechanism,
      timestamp: new Date().toISOString(),
    };
    for (const sink of this.#sinks) {
      try {
        sink.capture(event);
      } catch {
        // Sink isolation: a broken reporter sink must never break a turn.
      }
    }
  }
}
