import * as Schema from "effect/Schema";

/**
 * The trust-boundary wire format (§16/§27.2). Read agents emit Schema-validated
 * envelopes; write agents never see raw untrusted content — they re-validate the
 * payload against the kind's own schema before acting. `confirmed` and
 * `owner_approved` must both be exactly `true` to act.
 */
export const EnvelopeSchema = Schema.Struct({
  kind: Schema.String, // e.g. SECURITY_EVENT, EMAIL_SUMMARY (UPPER_SNAKE, §26)
  origin: Schema.Literals(["owner", "internal", "untrusted"]),
  payload: Schema.Record(Schema.String, Schema.Unknown),
  confirmed: Schema.Boolean,
  owner_approved: Schema.Boolean,
  _meta: Schema.Struct({
    agent_chain: Schema.Array(Schema.String), // read→…→write provenance
    trace_id: Schema.String, // W3C, propagates the OTel trace (§12)
    session_id: Schema.String,
    issued_at: Schema.String, // ISO; stamped by the emitter
    parent_trace_id: Schema.optional(Schema.String),
  }),
});
