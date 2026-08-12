import type { CapturedError } from "../../../src/runtime/types";

// The two coordinates parsed out of a Sentry-compatible DSN: where to POST the
// envelope, and the public key for the auth header. Neither is ever placed into
// an envelope body — the DSN stays on the transport, never in the payload.
export interface GlitchTipTarget {
  readonly endpoint: string;
  readonly publicKey: string;
}

// Everything the pure envelope builder needs. The caller supplies the event id
// so the builder stays deterministic (and testable); the timestamp rides along
// on the CapturedError. Only error identity plus environment/release cross the
// wire — no DSN, token, or path.
export interface SentryEnvelopeInput {
  readonly error: CapturedError;
  readonly environment: string;
  readonly release: string;
  readonly eventId: string;
}
