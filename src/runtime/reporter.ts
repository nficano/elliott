import { redactPatterns } from "./redaction";
import type { CapturedError, ErrorSink } from "./types";

// Neutral, transport-agnostic error visibility. Every captured failure is
// logged to the console (the always-on baseline) and normalized to a
// CapturedError — name, message, mechanism, timestamp only, never settings or
// secrets — before being handed to each registered sink.
//
// The message and name are redacted (redaction.ts) before they reach either the
// console or a sink, so a secret an upstream caller interpolated into an
// exception message cannot ride out on a log line or in a captured payload. The
// runtime seeds the redactor with the exact secret values known at the config
// boundary (DSN, Vault token, Vault paths); the default is pattern-only so even
// a bare reporter strips credential-shaped substrings.
//
// Sinks are optional and isolated: a sink that throws never breaks the loop,
// and with no sink installed (e.g. the glitchtip skill disabled or absent)
// capture() is console-only. No sink transport — Sentry envelopes, DSNs, HTTP —
// lives here; that belongs to the skill that installs the sink, so the core
// runtime carries no error-reporting vendor code.
export class RuntimeErrorReporter {
  readonly #sinks: ErrorSink[] = [];
  readonly #redact: (text: string) => string;

  constructor(redact: (text: string) => string = redactPatterns) {
    this.#redact = redact;
  }

  addSink(sink: ErrorSink): void {
    this.#sinks.push(sink);
  }

  capture(error: unknown, mechanism: string): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    const message = this.#redact(failure.message);
    console.error(`[${mechanism}] ${message}`);
    if (this.#sinks.length === 0) return;
    const event: CapturedError = {
      name: this.#redact(failure.name),
      message,
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
