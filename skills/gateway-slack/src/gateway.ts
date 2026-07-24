import { isJsonRecord } from "../../../src/providers/http";
import type {
  GatewayEvents,
  GatewayResponse,
} from "../../../src/runtime/skills/types";
import type {
  InboundContextEntity,
  InboundMessage,
  SlackSettings,
} from "../../../src/runtime/types";
import { agentMessageBlocks } from "./blocks";
import { postMessage } from "./client";
import { GATEWAY_NAME } from "./constants";
import {
  decodeContext,
  decodeInteraction,
  decodeMessage,
  decodeReactionFeedback,
} from "./events";
import { loadLiveThreadHistory, withoutRetainedHistory } from "./history";
import { handleAppHomeOpened } from "./onboarding";
import { SlackAgentResponse } from "./response";
import {
  chunkSlackText,
  openSlackSocket,
  parseSlackFrame,
  waitBeforeSlackReconnect,
} from "./socket";
import type {
  SlackGatewayDependencies,
  SlackJson,
  SlackSocket,
  SlackSocketFactory,
} from "./types";

export { GATEWAY_NAME } from "./constants";

export class SlackGateway {
  readonly name = GATEWAY_NAME;
  readonly defaultChannel: string;
  readonly #settings: SlackSettings;
  readonly #dependencies: SlackGatewayDependencies;
  readonly #openSocket: SlackSocketFactory;
  #events: GatewayEvents | undefined;
  #socket: SlackSocket | undefined;
  #active = false;
  #connected = false;
  #selfId: string | undefined;
  #latestContext: readonly InboundContextEntity[] = [];

  constructor(
    settings: SlackSettings,
    dependencies: SlackGatewayDependencies,
  ) {
    this.#settings = settings;
    this.#dependencies = dependencies;
    this.#openSocket = dependencies.openSocket ?? openSlackSocket;
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
    const target = channel || this.#settings.defaultChannel;
    let replyThread = thread;
    for (const chunk of chunkSlackText(text)) {
      const timestamp = await postMessage(this.#dependencies.clients.bot, {
        channel: target,
        text: chunk,
        blocks: agentMessageBlocks(chunk),
        ...(replyThread !== undefined && { thread_ts: replyThread }),
        unfurl_links: false,
        unfurl_media: false,
      });
      if (replyThread === undefined && target.startsWith("D")) {
        replyThread = timestamp;
        await this.#dependencies.clients.bot.request(
          "assistant.threads.setTitle",
          {
            channel_id: target,
            thread_ts: timestamp,
            title: "Elliott notification",
          },
        );
      }
    }
  }

  async beginResponse(message: InboundMessage): Promise<GatewayResponse> {
    const response = new SlackAgentResponse({
      client: this.#dependencies.clients.bot,
      message,
      report: this.#dependencies.report,
    });
    await response.start();
    return response;
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
      if (this.#active) await waitBeforeSlackReconnect();
    }
  }

  async #connectOnce(): Promise<void> {
    const opened = await this.#dependencies.clients.app.request(
      "apps.connections.open",
    );
    const url = opened["url"];
    if (typeof url !== "string") {
      throw new TypeError("Slack socket open response had no URL");
    }
    await new Promise<void>((resolve, reject) => {
      this.#openSocket(url, {
        onMessage: (raw) => this.#handleFrame(raw),
        onClose: resolve,
      }).then((socket) => {
        this.#socket = socket;
        this.#connected = true;
      }).catch(reject);
    });
  }

  #handleFrame(raw: string): void {
    const frame = parseSlackFrame(raw);
    if (frame === undefined) return;
    const envelope = frame["envelope_id"];
    if (typeof envelope === "string") {
      this.#socket?.send(JSON.stringify({ envelope_id: envelope }));
    }
    if (frame["type"] === "disconnect") {
      this.#socket?.close();
      return;
    }
    void this.#routeFrame(frame).catch((error: unknown) =>
      this.#events?.onError(error)
    );
  }

  async #routeFrame(frame: SlackJson): Promise<void> {
    const payload = frame["payload"];
    if (!isJsonRecord(payload)) return;
    if (frame["type"] === "interactive") {
      await this.#handleInteraction(payload);
      return;
    }
    if (frame["type"] !== "events_api") return;
    await this.#handleEvent(payload);
  }

  async #handleEvent(payload: SlackJson): Promise<void> {
    const event = payload["event"];
    if (!isJsonRecord(event)) return;
    if (event["type"] === "app_context_changed") {
      this.#latestContext = decodeContext(event["context"]);
      return;
    }
    if (event["type"] === "app_home_opened") {
      await this.#handleAppHome(event);
      return;
    }
    if (event["type"] === "reaction_added") {
      const feedback = decodeReactionFeedback(
        event,
        this.#settings.ownerId,
        this.#selfId,
      );
      if (feedback !== undefined) await this.#events?.onFeedback(feedback);
      return;
    }
    await this.#handleMessage(payload, event);
  }

  async #handleMessage(payload: SlackJson, event: SlackJson): Promise<void> {
    if (!this.#allowedMessage(event)) return;
    const team = payload["team_id"];
    const message = decodeMessage(
      event,
      this.#latestContext,
      typeof team === "string" ? team : undefined,
    );
    if (message === undefined) return;
    let contextual = withoutRetainedHistory(message);
    try {
      contextual = await loadLiveThreadHistory(
        this.#dependencies.clients.bot,
        message,
      );
    } catch (error) {
      this.#dependencies.report(error, "slack:conversations.replies");
    }
    await this.#events?.onMessage(contextual);
  }

  async #handleAppHome(event: SlackJson): Promise<void> {
    if (
      event["user"] !== this.#settings.ownerId
      || event["tab"] !== "messages"
      || typeof event["channel"] !== "string"
    ) return;
    const context = decodeContext(event["context"]);
    if (context.length > 0) this.#latestContext = context;
    await handleAppHomeOpened({
      client: this.#dependencies.clients.bot,
      channel: event["channel"],
      context,
    });
  }

  async #handleInteraction(payload: SlackJson): Promise<void> {
    const action = decodeInteraction(payload, this.#settings.ownerId);
    if (action === undefined) return;
    if (action.type === "delete") {
      await this.#dependencies.clients.bot.request("chat.delete", {
        channel: action.channel,
        ts: action.message,
      });
      return;
    }
    await this.#events?.onFeedback({
      gateway: GATEWAY_NAME,
      channel: action.channel,
      message: action.message,
      sender: action.sender,
      sentiment: action.sentiment,
      source: "button",
    });
  }

  #allowedMessage(event: SlackJson): boolean {
    return event["type"] === "message"
      && event["subtype"] === undefined
      && event["bot_id"] === undefined
      && event["user"] !== this.#selfId
      && event["user"] === this.#settings.ownerId;
  }

  async #resolveSelfId(): Promise<string | undefined> {
    const response = await this.#dependencies.clients.bot.request("auth.test");
    return typeof response["user_id"] === "string"
      ? response["user_id"]
      : undefined;
  }
}
