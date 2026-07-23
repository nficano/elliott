import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  Channel,
  Inbound,
  InboundHandler,
  Outbound,
} from "../core/channels/types.js";
import { ChannelError } from "../core/errors.js";
import type { Health } from "../core/types.js";
import { chunkText } from "./chunk.js";
import { TgUpdateSchema } from "./schema.js";
import type { TelegramConfig, TgUpdate } from "./types.js";

const TELEGRAM_LIMIT = 4096;
const POLL_RETRY_DELAY_MS = 3000;
const POLL_TIMEOUT_MS = 30_000;
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

export const TelegramUpdatesResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Array(TgUpdateSchema)),
});

const fetchTelegramUpdates = Effect.fn("channels.telegram.getUpdates")(
  function*(url: string) {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }),
      catch: (cause) =>
        new ChannelError({
          message: `telegram getUpdates: ${formatUnknownError(cause)}`,
          kind: "delivery",
          cause,
        }),
    });
    if (!response.ok) {
      return yield* Effect.fail(
        new ChannelError({
          message: `telegram getUpdates ${response.status}`,
          kind: "delivery",
        }),
      );
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new ChannelError({
          message: `telegram getUpdates: ${formatUnknownError(cause)}`,
          kind: "delivery",
          cause,
        }),
    });
    const payload = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(TelegramUpdatesResponseSchema),
    )(text).pipe(
      Effect.mapError((cause) =>
        new ChannelError({
          message: "telegram getUpdates returned an invalid payload",
          kind: "delivery",
          cause,
        })
      ),
    );
    if (!payload.ok) return [];
    if (payload.result === undefined) {
      return yield* Effect.fail(
        new ChannelError({
          message: "telegram getUpdates response omitted result",
          kind: "delivery",
        }),
      );
    }
    return [...payload.result];
  },
);

/**
 * Telegram channel (§16). Long-poll `getUpdates` (offset-tracked); the caller's
 * scheduler holds the single-owner `pg_advisory_lock` so two processes never
 * poll the same bot (fribbles_bot 409 fix, §15). Delivery chunks to 4096 chars
 * (§20). Owner messages are `origin: owner`; everyone else is `untrusted` and
 * hits the injection screen (§16).
 */
export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private offset = 0;
  private polling = false;
  private stopped = false;
  private readonly base: string;

  constructor(private readonly cfg: TelegramConfig) {
    this.base = `${cfg.apiBase ?? "https://api.telegram.org"}/bot${cfg.token}`;
  }

  async listen(onInbound: InboundHandler): Promise<void> {
    this.polling = true;
    this.stopped = false;
    void this.pollLoop(onInbound);
  }

  private async pollLoop(onInbound: InboundHandler): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates();
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          const inbound = this.toInbound(u);
          if (inbound) await onInbound(inbound);
        }
      } catch (error) {
        // Never let the poll loop die on a transient error; back off and retry.
        if (!this.stopped) await delay(POLL_RETRY_DELAY_MS);
        void error;
      }
    }
    this.polling = false;
  }

  private async getUpdates(): Promise<TgUpdate[]> {
    return Effect.runPromise(fetchTelegramUpdates(
      `${this.base}/getUpdates?timeout=25&offset=${this.offset}&allowed_updates=["message"]`,
    ));
  }

  private toInbound(u: TgUpdate): Inbound | undefined {
    const m = u.message;
    if (!m?.text) return undefined;
    const senderId = String(m.from?.id ?? "");
    return {
      channel: "telegram",
      externalId: String(u.update_id),
      conversationKey: `telegram:${m.chat.id}`,
      senderId,
      text: m.text,
      origin: senderId === this.cfg.ownerId ? "owner" : "untrusted",
      receivedAt: new Date(m.date * MILLISECONDS_PER_SECOND).toISOString(),
    };
  }

  send(out: Outbound): Effect.Effect<void, ChannelError> {
    const chatId = out.conversationKey.replace(/^telegram:/, "");
    return Effect.tryPromise({
      try: () => this.deliver(chatId, out.text),
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

  private async deliver(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkText(text, TELEGRAM_LIMIT)) {
      const res = await fetch(`${this.base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      if (!res.ok) {
        if (res.status === HTTP_TOO_MANY_REQUESTS) {
          throw new ChannelError({
            message: "telegram rate limit",
            kind: "limit",
          });
        }
        if (
          res.status === HTTP_UNAUTHORIZED || res.status === HTTP_FORBIDDEN
        ) {
          throw new ChannelError({ message: "telegram auth", kind: "auth" });
        }
        throw new ChannelError({
          message: `telegram sendMessage ${res.status}`,
          kind: "delivery",
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async health(): Promise<Health> {
    return this.polling
      ? { state: "ok" }
      : { state: "degraded", detail: "not polling" };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatUnknownError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
