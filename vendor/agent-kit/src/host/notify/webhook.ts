import * as Effect from "effect/Effect";
import { ChannelError } from "../../core/errors.js";
import type { NotifyPort, NotifySend } from "../../core/notify/types.js";
import type { WebhookNotifyConfig } from "./types.js";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_MULTI_STATUS = 207;

/**
 * Outbound alert delivery (§16.4) — a plain HTTP POST to the homelab notify
 * webhook. agent-kit holds only the one bearer token; per-channel connectors +
 * secrets live in `api-h12o`. The framework passes only `body` (+ an allow-listed
 * `channel`); it NEVER forwards a recipient taken from untrusted JSON, so an
 * injected `chat_id` can't redirect a notification.
 */
export class WebhookNotify implements NotifyPort {
  constructor(private readonly cfg: WebhookNotifyConfig) {}

  send(msg: NotifySend): Effect.Effect<void, ChannelError> {
    const payload = {
      body: msg.body,
      subject: msg.subject,
      channels: msg.channels ?? this.cfg.defaultChannels,
      dryRun: msg.dryRun ?? false,
    };
    return Effect.tryPromise({
      try: () => this.post(payload),
      catch: (cause) =>
        cause instanceof ChannelError
          ? cause
          : new ChannelError({
            message: String(cause),
            kind: "delivery",
            cause,
          }),
    });
  }

  private async post(payload: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.cfg.token) headers.authorization = `Bearer ${this.cfg.token}`;
    const res = await fetch(this.cfg.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (
        res.status === HTTP_UNAUTHORIZED
        || res.status === HTTP_FORBIDDEN
      ) {
        throw new ChannelError({ message: "notify auth", kind: "auth" });
      }
      if (res.status === HTTP_TOO_MANY_REQUESTS) {
        throw new ChannelError({ message: "notify rate limit", kind: "limit" });
      }
      throw new ChannelError({
        message: `notify webhook ${res.status}`,
        kind: "delivery",
      });
    }
    // 207 Multi-Status = at least one channel failed; res.ok is true for 2xx.
    if (res.status === HTTP_MULTI_STATUS) {
      throw new ChannelError({
        message: "notify partial failure",
        kind: "delivery",
      });
    }
  }
}
