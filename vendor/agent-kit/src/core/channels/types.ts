import type * as Effect from "effect/Effect";
import type { ChannelError } from "../errors.js";
import type { Health } from "../types.js";
import type { Origin } from "../types.js";

/**
 * Channels (§16) are `kind:channel` registrables: inbound → normalized `Inbound`,
 * plus delivery. Chunking + per-channel entity escaping is a *channel-adapter
 * contract* (§20) — the adapter splits/escapes, the loop emits plain text.
 */
export interface Inbound {
  readonly channel: string; // "telegram" | "imessage" | "slack" | "http"
  /** Stable per-message id for dedupe (Telegram update_id / iMessage GUID, §14). */
  readonly externalId: string;
  /** Conversation key = channel or channel:thread (§27.1 history PK). */
  readonly conversationKey: string;
  readonly senderId: string;
  readonly text: string;
  /** Set by the injection screen (§16); untrusted pins the safe bundle. */
  readonly origin: Origin;
  readonly attachments?: InboundAttachment[];
  readonly receivedAt: string; // ISO
}

export interface InboundAttachment {
  readonly kind: "image" | "audio" | "file";
  readonly ref: string; // pointer/url, never inlined bytes into memory (§7.4)
  readonly mime?: string;
}

export interface Outbound {
  readonly conversationKey: string;
  /** Plain text/markdown; the adapter handles chunking + escaping (§20). */
  readonly text: string;
  readonly replyToExternalId?: string;
}

export type InboundHandler = (msg: Inbound) => Promise<void>;

/** A channel adapter — inbound listener + outbound delivery. */
export interface Channel {
  readonly name: string;
  /** Begin receiving; each inbound is dispatched through `onInbound`. */
  listen(onInbound: InboundHandler): Promise<void>;
  send(out: Outbound): Effect.Effect<void, ChannelError>;
  stop(): Promise<void>;
  health(): Promise<Health>;
}
