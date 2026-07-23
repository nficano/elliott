import type { SlackSocketFrameSchema, TgUpdateSchema } from "./schema.js";

export interface TelegramConfig {
  readonly token: string;
  readonly ownerId: string;
  readonly apiBase?: string;
}

/**
 * Slack config (ported from the api-h12o `slack` connector). Outbound: set one
 * mode — `botToken` (xoxb-, → chat.postMessage, channel from the conversationKey
 * or `defaultChannel`) or `webhookUrl` (channel fixed by the hook); botToken
 * wins if both are set. Inbound: `appToken` (xapp-, connections:write) turns on
 * the Socket Mode listener; `ownerId` is the Slack user whose messages arrive
 * as `origin: owner` (everyone else is `untrusted`, §16).
 */
export interface SlackConfig {
  readonly botToken?: string;
  readonly webhookUrl?: string;
  readonly apiBase?: string; // default https://slack.com/api
  readonly defaultChannel?: string; // bot mode fallback when the key has no channel
  readonly appToken?: string; // xapp- app-level token → Socket Mode inbound
  readonly ownerId?: string; // Slack user id gating origin: owner
}

/** The two callbacks a Socket Mode connection feeds the adapter. */
export interface SlackSocketHandlers {
  readonly onFrame: (raw: string) => void;
  readonly onClose: () => void;
}

/** A live Socket Mode connection — enough surface to ack frames and hang up. */
export interface SlackSocket {
  send(data: string): void;
  close(): void;
}

/**
 * Slack delivery seams — production wires the official Slack SDK (WebClient /
 * IncomingWebhook) and a real WebSocket; tests inject fakes to drive the
 * adapter without the network.
 */
export interface SlackChannelDeps {
  readonly postMessage?: (channel: string, text: string) => Promise<void>;
  readonly postWebhook?: (text: string) => Promise<void>;
  /** Test seam: open a Socket Mode connection (resolves once connected). */
  readonly openSocket?: (handlers: SlackSocketHandlers) => Promise<SlackSocket>;
  /** Test seam: the bot's own user id — skips the auth.test lookup. */
  readonly selfId?: string;
}

export type SlackSocketFrame = typeof SlackSocketFrameSchema.Type;

/** The message-event slice of a Socket Mode events_api envelope. */
export type SlackMessageEvent = NonNullable<
  SlackSocketFrame["payload"]
>["event"];

/** idle = not listening (or stopped); the loop runs while non-idle. */
export type SlackSocketState = "idle" | "connected" | "disconnected";

/** Everything the Socket Mode listener needs, all optional but appToken
 *  (tests may inject `openSocket` instead of a real token). */
export interface SlackSocketListenerOptions {
  readonly appToken?: string;
  readonly botToken?: string; // auth.test → own user id for self-filtering
  readonly apiBase?: string;
  readonly ownerId?: string;
  readonly selfId?: string;
  readonly openSocket?: (handlers: SlackSocketHandlers) => Promise<SlackSocket>;
}

/**
 * iMessage/SMS outbound config (ported from the api-h12o `imessage`/bluebubbles
 * connector) — talks to a BlueBubbles server's REST API. The recipient (a
 * handle or a full chat GUID) comes from the conversationKey, or `defaultRecipient`.
 */
export interface ImessageConfig {
  readonly password: string;
  readonly serverUrl?: string; // BlueBubbles base; defaults to host.docker.internal:1234
  readonly method?: "apple-script" | "private-api"; // default apple-script
  readonly service?: "iMessage" | "SMS"; // default iMessage
  readonly defaultRecipient?: string;
}

export type TgUpdate = typeof TgUpdateSchema.Type;
