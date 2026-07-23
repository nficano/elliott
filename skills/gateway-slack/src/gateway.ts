import { isJsonRecord } from "../../../src/providers/http";
import type { GatewayEvents } from "../../../src/runtime/skills/types";
import type { InboundMessage, SlackSettings } from "../../../src/runtime/types";
import type { SlackSocket, SlackSocketHandlers } from "./types";

export const GATEWAY_NAME = "gateway-slack";

const SLACK_API = "https://slack.com/api";
const RETRY_DELAY_MILLISECONDS = 3000;
const MESSAGE_CHUNK_CHARACTERS = 3900;

export class SlackGateway {
  readonly name = GATEWAY_NAME;
  readonly defaultChannel: string;
  readonly #settings: SlackSettings;
  #events: GatewayEvents | undefined;
  #socket: SlackSocket | undefined;
  #active = false;
  #connected = false;
  #selfId: string | undefined;

  constructor(settings: SlackSettings) {
    this.#settings = settings;
    this.defaultChannel = settings.defaultChannel;
  }

  status(): string {
    return this.#connected ? "connected" : "connecting";
  }

  async start(events: GatewayEvents): Promise<void> {
    this.#events = events;
    this.#active = true;
    this.#selfId = await this.#resolveSelfId();
    void this.#listen();
  }

  async send(channel: string, text: string, thread?: string): Promise<void> {
    for (const chunk of chunkText(text)) {
      const response = await slackRequest(
        "chat.postMessage",
        this.#settings.botToken,
        {
          channel: channel || this.#settings.defaultChannel,
          text: chunk,
          ...(thread !== undefined && { thread_ts: thread }),
        },
      );
      if (response["ok"] !== true) {
        throw new Error(`Slack delivery failed: ${String(response["error"])}`);
      }
    }
  }

  stop(): void {
    this.#active = false;
    this.#connected = false;
    this.#socket?.close();
  }

  async #listen(): Promise<void> {
    while (this.#active) {
      try {
        await this.#connectOnce();
      } catch (error) {
        this.#events?.onError(error);
      }
      this.#connected = false;
      if (this.#active) await delay(RETRY_DELAY_MILLISECONDS);
    }
  }

  async #connectOnce(): Promise<void> {
    const opened = await slackRequest(
      "apps.connections.open",
      this.#settings.appToken,
      {},
    );
    const url = opened["url"];
    if (opened["ok"] !== true || typeof url !== "string") {
      throw new Error(`Slack socket open failed: ${String(opened["error"])}`);
    }
    await new Promise<void>((resolve, reject) => {
      openSocket(url, {
        onMessage: (raw) => this.#handleFrame(raw),
        onClose: resolve,
      }).then((socket) => {
        this.#socket = socket;
        this.#connected = true;
      }).catch(reject);
    });
  }

  #handleFrame(raw: string): void {
    const frame = parseFrame(raw);
    if (frame === undefined) return;
    const envelopeId = frame["envelope_id"];
    if (typeof envelopeId === "string") {
      this.#socket?.send(JSON.stringify({ envelope_id: envelopeId }));
    }
    if (frame["type"] === "disconnect") {
      this.#socket?.close();
      return;
    }
    if (frame["type"] !== "events_api") return;
    const payload = frame["payload"];
    if (!isJsonRecord(payload)) return;
    const event = payload["event"];
    if (!isJsonRecord(event) || !this.#allowedMessage(event)) return;
    this.#dispatch(event);
  }

  #dispatch(event: Readonly<Record<string, unknown>>): void {
    const message = decodeMessage(event);
    if (message === undefined) return;
    const events = this.#events;
    if (events === undefined) return;
    void events.onMessage(message).catch(events.onError);
  }

  #allowedMessage(event: Readonly<Record<string, unknown>>): boolean {
    return event["type"] === "message"
      && event["subtype"] === undefined
      && event["bot_id"] === undefined
      && event["user"] !== this.#selfId
      && event["user"] === this.#settings.ownerId;
  }

  async #resolveSelfId(): Promise<string | undefined> {
    const response = await slackRequest("auth.test", this.#settings.botToken);
    return response["ok"] === true && typeof response["user_id"] === "string"
      ? response["user_id"]
      : undefined;
  }
}

const parseFrame = (
  raw: string,
): Readonly<Record<string, unknown>> | undefined => {
  try {
    const frame: unknown = JSON.parse(raw);
    return isJsonRecord(frame) ? frame : undefined;
  } catch {
    return undefined;
  }
};

const decodeMessage = (
  event: Readonly<Record<string, unknown>>,
): InboundMessage | undefined => {
  const channel = event["channel"];
  const sender = event["user"];
  const text = event["text"];
  const timestamp = event["ts"];
  if (
    typeof channel !== "string" || typeof sender !== "string"
    || typeof text !== "string" || typeof timestamp !== "string"
  ) return undefined;
  const thread = event["thread_ts"];
  return {
    id: `${channel}:${timestamp}`,
    gateway: GATEWAY_NAME,
    channel,
    ...(typeof thread === "string" && { thread }),
    sender,
    text,
  };
};

const slackRequest = async (
  method: string,
  token: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> => {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const value: unknown = await response.json();
  if (!response.ok || !isJsonRecord(value)) {
    throw new Error(`Slack ${method} returned HTTP ${response.status}`);
  }
  return value;
};

const openSocket = (
  url: string,
  handlers: SlackSocketHandlers,
): Promise<SlackSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () =>
      resolve({
        send: (value) => socket.send(value),
        close: () => socket.close(),
      }));
    socket.addEventListener("message", (event) =>
      handlers.onMessage(String(event.data)));
    socket.addEventListener("close", handlers.onClose);
    socket.addEventListener("error", () =>
      reject(new Error("Slack socket failed")));
  });

const chunkText = (text: string): readonly string[] => {
  if (text.length <= MESSAGE_CHUNK_CHARACTERS) return [text];
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < text.length;
    offset += MESSAGE_CHUNK_CHARACTERS
  ) {
    chunks.push(text.slice(offset, offset + MESSAGE_CHUNK_CHARACTERS));
  }
  return chunks;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
