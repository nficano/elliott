import type { TransmittableError } from "../../../src/runtime/types";

// The two coordinates parsed out of a Sentry-compatible DSN: where to POST the
// envelope, and the public key for the auth header. Neither is ever placed into
// an envelope body — the DSN stays on the transport, never in the payload.
export interface GlitchTipTarget {
  readonly endpoint: string;
  readonly publicKey: string;
}

// Everything the pure envelope builder needs. The caller supplies the event id
// so the builder stays deterministic (and testable); the timestamp rides along
// on the TransmittableError. The error carries no message — only its class name,
// stack frames, and mechanism — so nothing that could hold an interpolated secret
// crosses the wire. No deployment environment/release is transmitted either: they
// come from env variables that could coincide with a resolved secret, so only the
// error's structural identity (class + frames + mechanism + timestamp) and the
// generated event id cross the wire — no DSN, token, path, message, or env-sourced
// metadata.
export interface SentryEnvelopeInput {
  readonly error: TransmittableError;
  readonly eventId: string;
}
