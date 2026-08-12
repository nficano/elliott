import type { ErrorSink, TransmittableError } from "./types";

const MAX_TRANSMITTED_FRAMES = 30;
const STACK_FRAME_LINE = /^\s+at\s/;
// A genuine V8 frame carries a source location — a colon immediately followed by
// a digit (`file:line`, `:line:col`, `native:1:11`). Kept simple/linear on
// purpose (no backtracking): the header slice below is the primary defense; this
// only trims the odd non-frame line that survives it.
const STACK_FRAME_LOCATION = /:\d/;

// Extract only the real stack FRAMES from an error's stack, never any part of
// its message. The stack is `${name}: ${message}` followed by the frames, so the
// header spans exactly as many lines as the message — even when the message
// itself contains lines that look like frames (e.g. "safe\n    at <secret>").
// We therefore drop the header by its known LINE COUNT rather than by pattern:
// an attacker cannot smuggle a message line past the cut, because any newline
// they add to the message grows the cut by the same amount. What remains are
// genuine V8 frames (kept only if they carry a real source location); these are
// code locations, never runtime values. Bounded so a deep stack cannot bloat a
// payload.
const stackFrames = (error: Error): readonly string[] => {
  const stack = error.stack;
  if (typeof stack !== "string") return [];
  const headerLineCount = error.message.split("\n").length;
  return stack
    .split("\n")
    .slice(headerLineCount)
    .filter((line) =>
      STACK_FRAME_LINE.test(line) && STACK_FRAME_LOCATION.test(line)
    )
    .map((line) => line.trim())
    .slice(0, MAX_TRANSMITTED_FRAMES);
};

// Neutral, transport-agnostic error visibility with a STRUCTURAL secret
// boundary. capture() does two separate things:
//
//   1. Logs the full failure to the local console (the always-on baseline).
//      This is the operator's own process output; it does not cross the process
//      boundary, so it may carry the full message including any interpolated
//      secret — per the doctrine that only what LEAVES the process is
//      constrained.
//   2. Normalizes the failure to a TransmittableError — error class, stack
//      frames, mechanism, timestamp, and DELIBERATELY NO message — and fans it
//      out to each registered sink. Because a TransmittableError carries no
//      free-form message, a sink transmitting it off-box cannot exfiltrate a
//      secret interpolated into an exception message. This replaces redaction:
//      instead of scrubbing secrets out of transmitted text, no text that can
//      hold an interpolated secret is transmitted at all.
//
// Sinks are optional and isolated: a sink that throws never breaks the loop, and
// with no sink installed (glitchtip disabled or absent) capture() is
// console-only. No sink transport — Sentry envelopes, DSNs, HTTP — lives here;
// that belongs to the skill that installs the sink.
export class RuntimeErrorReporter {
  readonly #sinks: ErrorSink[] = [];

  addSink(sink: ErrorSink): void {
    this.#sinks.push(sink);
  }

  capture(error: unknown, mechanism: string): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    // Local console only — full text is fine here (does not leave the process).
    console.error(`[${mechanism}] ${failure.message}`);
    if (this.#sinks.length === 0) return;
    const event: TransmittableError = {
      name: failure.name,
      frames: stackFrames(failure),
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
