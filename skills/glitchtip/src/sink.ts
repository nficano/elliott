import type { ServiceBinding } from "../../../src/runtime/skills/types";
import type { ErrorSink, TransmittableError } from "../../../src/runtime/types";
import { buildSentryEnvelope, sentryAuthHeader } from "./envelope";
import type { GlitchTipTarget } from "./types";

const MAX_QUEUED_EVENTS = 100;
const SEND_TIMEOUT_MILLISECONDS = 5000;
const ENVELOPE_CONTENT_TYPE = "application/x-sentry-envelope";

// A bounded, drop-oldest error sink that ships TransmittableErrors to a Sentry-
// compatible collector as envelopes. Design goals, in priority order:
//   1. Never break the loop — capture() only enqueues, and delivery is
//      fire-and-forget with every network failure swallowed.
//   2. Bounded memory — at most MAX_QUEUED_EVENTS are held; past the cap the
//      oldest is dropped, so an unreachable collector cannot grow the queue.
//   3. No secret on the wire beyond the DSN's own auth header — the envelope
//      body is built from the TransmittableError alone.
// The sink is registered against the runtime error reporter; killing the
// collector mid-run just turns every send into a swallowed failure.
export class GlitchTipSink implements ErrorSink {
  readonly #target: GlitchTipTarget;
  readonly #queue: TransmittableError[] = [];
  #sent = 0;
  #dropped = 0;
  #draining = false;
  #stopped = false;

  constructor(input: { readonly target: GlitchTipTarget; }) {
    this.#target = input.target;
  }

  capture(event: TransmittableError): void {
    if (this.#stopped) return;
    if (this.#queue.length >= MAX_QUEUED_EVENTS) {
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(event);
    void this.#drain();
  }

  // A health-only service: /healthz surfaces the counters (numbers only, never
  // a DSN, host, or payload), and stop() drops anything still queued so a
  // shutdown never blocks on the collector.
  service(): ServiceBinding {
    return {
      name: "glitchtip",
      start: () => {
        void this.#drain();
      },
      stop: () => {
        this.#stopped = true;
        this.#queue.length = 0;
      },
      health: () => ({
        queued: this.#queue.length,
        sent: this.#sent,
        dropped: this.#dropped,
      }),
    };
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0 && !this.#stopped) {
        const event = this.#queue[0];
        if (event === undefined) break;
        const delivered = await this.#send(event);
        // Collector unreachable: leave the event queued and stop this pass; the
        // next capture() retries, and the cap keeps memory bounded meanwhile.
        if (!delivered) break;
        this.#queue.shift();
        this.#sent += 1;
      }
    } finally {
      this.#draining = false;
    }
  }

  async #send(event: TransmittableError): Promise<boolean> {
    const envelope = buildSentryEnvelope({
      error: event,
      eventId: crypto.randomUUID().replaceAll("-", ""),
    });
    try {
      const response = await fetch(this.#target.endpoint, {
        method: "POST",
        headers: {
          "content-type": ENVELOPE_CONTENT_TYPE,
          "x-sentry-auth": sentryAuthHeader(this.#target.publicKey),
        },
        body: envelope,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MILLISECONDS),
      });
      return response.ok;
    } catch {
      // Unreachable collector, timeout, DNS failure: swallow. The event stays
      // queued (bounded) and neither the sink nor the loop crashes.
      return false;
    }
  }
}
