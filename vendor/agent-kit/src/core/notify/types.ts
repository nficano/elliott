import type * as Effect from "effect/Effect";
import type { ChannelError } from "../errors.js";

/**
 * Outbound alert delivery (§16.4). NOT an agent — a plain HTTP POST to the
 * homelab notify webhook (`api.h12o.io/api/notify`). agent-kit holds only the
 * one bearer token; per-channel connectors/secrets live in `api-h12o`.
 *
 * Trust property: the framework passes only `body` (+ an allow-listed
 * `channel`); it NEVER forwards a recipient (`to`) taken from untrusted JSON —
 * destination defaults live in the connector, so an injected `chat_id` can't
 * redirect a notification.
 */
export interface NotifySend {
  readonly body: string;
  readonly subject?: string;
  /** Allow-listed connector name(s); defaults come from config (§5 notify). */
  readonly channels?: string[];
  /** Preview without sending (§16.4). */
  readonly dryRun?: boolean;
}

export interface NotifyPort {
  send(msg: NotifySend): Effect.Effect<void, ChannelError>;
}
