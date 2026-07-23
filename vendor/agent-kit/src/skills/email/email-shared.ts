import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ToolMeta } from "../../core/agent/types.js";
import type { GmailCreds } from "./email-gmail/types.js";

/** OAuth creds every email registrable requires (gmail.modify scope). */
export const CredsSchema = {
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(true)),
  ),
  client_id: Schema.String,
  client_secret: Schema.String,
  refresh_token: Schema.String,
};

/** Narrow arbitrary config down to just the Gmail creds. */
export function creds(c: GmailCreds): GmailCreds {
  return {
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: c.refresh_token,
  };
}

/** Tool attribution/routing metadata for an email registrable. */
export function emailMeta(componentId: string, write: boolean): ToolMeta {
  return { componentId, bundle: "comms", core: false, write };
}
