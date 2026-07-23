import * as Schema from "effect/Schema";

export const TgUpdateSchema = Schema.Struct({
  update_id: Schema.Number,
  message: Schema.optionalKey(
    Schema.Struct({
      date: Schema.Number,
      text: Schema.optionalKey(Schema.String),
      chat: Schema.Struct({ id: Schema.Number }),
      from: Schema.optionalKey(Schema.Struct({ id: Schema.Number })),
    }),
  ),
});

/** Socket Mode frame — control frames (hello/disconnect) plus `events_api`
 *  envelopes; models only the message-event fields the adapter consumes. */
export const SlackSocketFrameSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  envelope_id: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(
    Schema.Struct({
      event: Schema.optionalKey(
        Schema.Struct({
          type: Schema.optionalKey(Schema.String),
          subtype: Schema.optionalKey(Schema.String),
          text: Schema.optionalKey(Schema.String),
          user: Schema.optionalKey(Schema.String),
          bot_id: Schema.optionalKey(Schema.String),
          channel: Schema.optionalKey(Schema.String),
          ts: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
});

/** `auth.test` response slice — just enough to learn the bot's own user id. */
export const SlackAuthTestSchema = Schema.Struct({
  ok: Schema.Boolean,
  user_id: Schema.optionalKey(Schema.String),
});

/** `apps.connections.open` response slice — the wss URL (or the error). */
export const SlackConnectionsOpenSchema = Schema.Struct({
  ok: Schema.Boolean,
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});

/** BlueBubbles REST response — success wraps `{ status: 200, data: { guid } }`;
 *  a `status >= 400` (with `message`) is a failure. */
export const BlueBubblesResponseSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.Number),
  message: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(
    Schema.Struct({ guid: Schema.optionalKey(Schema.String) }),
  ),
});
