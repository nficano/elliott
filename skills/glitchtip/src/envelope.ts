import type { GlitchTipTarget, SentryEnvelopeInput } from "./types";

const SENTRY_PROTOCOL_VERSION = "7";
// Stands in for the Sentry exception `value` (normally the message). The message
// is never transmitted — it is the one field that can carry an interpolated
// secret — so the collector shows this placeholder and points at the local logs.
const WITHHELD_VALUE = "(message withheld off-box; see local logs)";

// Pure builder for the GlitchTip/Sentry envelope: the envelope header line, the
// item header line, then the event payload, newline-joined. It reads only the
// TransmittableError (error class + stack frames + mechanism + timestamp) plus
// environment/release — there is NO message field to build from, so no
// interpolated secret can enter the payload by construction. No redaction is
// applied or needed: what can't hold a secret can't leak one.
export const buildSentryEnvelope = (input: SentryEnvelopeInput): string => {
  const event = {
    event_id: input.eventId,
    timestamp: input.error.timestamp,
    platform: "javascript",
    environment: input.environment,
    release: input.release,
    level: "error",
    exception: {
      values: [{
        type: input.error.name,
        value: WITHHELD_VALUE,
        stacktrace: {
          frames: input.error.frames.map((frame) => ({ function: frame })),
        },
      }],
    },
    tags: { mechanism: input.error.mechanism },
  };
  return [
    JSON.stringify({ event_id: input.eventId, sent_at: input.error.timestamp }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
};

// Parse a Sentry-compatible DSN into its POST endpoint and public key. Throws
// on a malformed DSN with a message that does NOT echo the DSN, so a bad value
// cannot leak through a log line; the caller degrades to console-only.
export const parseDsn = (dsn: string): GlitchTipTarget => {
  const url = new URL(dsn);
  const project = url.pathname.split("/").findLast(Boolean);
  if (url.username.length === 0 || project === undefined) {
    throw new Error("GlitchTip DSN is invalid");
  }
  const basePath = url.pathname.slice(
    0,
    url.pathname.lastIndexOf(`/${project}`),
  );
  return {
    publicKey: url.username,
    endpoint:
      `${url.protocol}//${url.host}${basePath}/api/${project}/envelope/`,
  };
};

export const sentryAuthHeader = (publicKey: string): string =>
  `Sentry sentry_version=${SENTRY_PROTOCOL_VERSION}, sentry_key=${publicKey}`;
