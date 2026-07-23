import * as Schema from "effect/Schema";
import type { Inbound, InboundHandler } from "../core/channels/types.js";
import { ChannelError } from "../core/errors.js";
import {
  SlackAuthTestSchema,
  SlackConnectionsOpenSchema,
  SlackSocketFrameSchema,
} from "./schema.js";
import type {
  SlackMessageEvent,
  SlackSocket,
  SlackSocketFrame,
  SlackSocketHandlers,
  SlackSocketListenerOptions,
  SlackSocketState,
} from "./types.js";

const DEFAULT_API_BASE = "https://slack.com/api";
const SOCKET_RETRY_DELAY_MS = 3000;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Socket Mode inbound (§16): holds the wss connection Slack hands out via
 * `apps.connections.open`, acks every envelope, and maps plain human `message`
 * events to `Inbound`. The bot's own posts (the notify connector uses the same
 * bot user) are dropped by bot_id/self-id, subtypes (edits, deletes, joins)
 * are ignored, and only `ownerId` arrives as `origin: owner`. Slack refresh-
 * cycles connections with `disconnect` frames — the loop reconnects until
 * `stop()`. A live connection is also what lights the bot's presence dot.
 */
export class SlackSocketListener {
  private socket: SlackSocket | undefined;
  private state: SlackSocketState = "idle";
  private selfId: string | undefined;
  private readonly openSocket: (
    handlers: SlackSocketHandlers,
  ) => Promise<SlackSocket>;

  constructor(private readonly opts: SlackSocketListenerOptions) {
    this.openSocket = opts.openSocket
      ?? ((handlers) => this.openProductionSocket(handlers));
  }

  get status(): SlackSocketState {
    return this.state;
  }

  async listen(onInbound: InboundHandler): Promise<void> {
    this.state = "disconnected";
    this.selfId = this.opts.selfId ?? (await this.resolveSelfId());
    void this.loop(onInbound);
  }

  stop(): void {
    this.state = "idle";
    this.socket?.close();
  }

  /** Reconnect until stopped; a dropped socket is never fatal. */
  private async loop(onInbound: InboundHandler): Promise<void> {
    // state is re-read via a method: stop() flips it from outside this flow,
    // which TS's narrowing would otherwise reason away.
    while (this.isActive()) {
      try {
        await this.connectOnce(onInbound); // resolves when the socket closes
      } catch {
        // fall through to the retry delay; never let the loop die
      }
      if (this.isActive()) await delay(SOCKET_RETRY_DELAY_MS);
    }
  }

  private isActive(): boolean {
    return this.state !== "idle";
  }

  private async connectOnce(onInbound: InboundHandler): Promise<void> {
    let onClosed!: () => void;
    const closed = new Promise<void>((resolve) => (onClosed = resolve));
    const socket = await this.openSocket({
      onFrame: (raw) => this.handleFrame(raw, onInbound),
      onClose: () => {
        if (this.state === "connected") this.state = "disconnected";
        onClosed();
      },
    });
    this.socket = socket;
    if (this.state === "disconnected") this.state = "connected";
    console.log("slack: socket mode connected");
    await closed;
    if (this.state !== "idle") {
      console.log("slack: socket mode disconnected; reconnecting");
    }
  }

  private handleFrame(raw: string, onInbound: InboundHandler): void {
    const frame = decodeFrame(raw);
    if (!frame) return;
    // Ack first — Slack redelivers (and eventually disconnects) without it.
    if (frame.envelope_id !== undefined) {
      this.socket?.send(JSON.stringify({ envelope_id: frame.envelope_id }));
    }
    if (frame.type === "disconnect") {
      this.socket?.close();
      return;
    }
    if (frame.type !== "events_api") return;
    const inbound = toSlackInbound({
      event: frame.payload?.event,
      selfId: this.selfId,
      ownerId: this.opts.ownerId,
    });
    if (inbound) void onInbound(inbound);
  }

  /** The socket URL comes from apps.connections.open with the app token. */
  private async openProductionSocket(
    handlers: SlackSocketHandlers,
  ): Promise<SlackSocket> {
    const base = this.opts.apiBase ?? DEFAULT_API_BASE;
    const res = await fetch(`${base}/apps.connections.open`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.appToken}` },
    });
    const open = Schema.decodeUnknownSync(SlackConnectionsOpenSchema)(
      await res.json(),
    );
    if (!open.ok || open.url === undefined) {
      throw new ChannelError({
        message: `slack: apps.connections.open ${open.error ?? res.status}`,
        kind: "auth",
      });
    }
    return connectWebSocket(open.url, handlers);
  }

  /** Own user id (for self-filtering); best-effort — undefined on failure. */
  private async resolveSelfId(): Promise<string | undefined> {
    if (!this.opts.botToken) return undefined;
    try {
      const base = this.opts.apiBase ?? DEFAULT_API_BASE;
      const res = await fetch(`${base}/auth.test`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.botToken}` },
      });
      const auth = Schema.decodeUnknownSync(SlackAuthTestSchema)(
        await res.json(),
      );
      return auth.ok ? auth.user_id : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Plain human `message` events only — no subtypes, no bots, not ourself. */
export function toSlackInbound(options: {
  readonly event: SlackMessageEvent;
  readonly selfId: string | undefined;
  readonly ownerId: string | undefined;
}): Inbound | undefined {
  const msg = addressedHumanMessage(options.event, options.selfId);
  if (!msg) return undefined;
  return {
    channel: "slack",
    externalId: `${msg.channel}:${msg.ts}`,
    conversationKey: `slack:${msg.channel}`,
    senderId: msg.user,
    text: msg.text,
    origin: msg.user === options.ownerId ? "owner" : "untrusted",
    receivedAt: tsToIso(msg.ts),
  };
}

function addressedHumanMessage(
  event: SlackMessageEvent,
  selfId: string | undefined,
): { text: string; user: string; channel: string; ts: string; } | undefined {
  if (!isPlainMessage(event)) return undefined;
  const { text, user, channel, ts } = event!;
  if (text === undefined || text === "" || user === undefined) {
    return undefined;
  }
  if (user === selfId || channel === undefined || ts === undefined) {
    return undefined;
  }
  return { text, user, channel, ts };
}

function isPlainMessage(event: SlackMessageEvent): boolean {
  return event?.type === "message" && event.subtype === undefined
    && event.bot_id === undefined;
}

function decodeFrame(raw: string): SlackSocketFrame | undefined {
  try {
    return Schema.decodeUnknownSync(SlackSocketFrameSchema)(JSON.parse(raw));
  } catch {
    return undefined; // unmodeled frame types are fine to ignore
  }
}

/** Slack event `ts` is epoch seconds with a decimal suffix. */
function tsToIso(ts: string): string {
  const ms = Number(ts) * MILLISECONDS_PER_SECOND;
  return Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : new Date().toISOString();
}

/** Wrap the runtime WebSocket; resolves once open so callers see `connected`. */
function connectWebSocket(
  url: string,
  handlers: SlackSocketHandlers,
): Promise<SlackSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () =>
      resolve({
        send: (data) => ws.send(data),
        close: () => ws.close(),
      }));
    ws.addEventListener("error", () =>
      reject(
        new ChannelError({
          message: "slack: socket connect error",
          kind: "delivery",
        }),
      ));
    ws.addEventListener(
      "message",
      (event) => handlers.onFrame(String(event.data)),
    );
    ws.addEventListener("close", () => handlers.onClose());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
