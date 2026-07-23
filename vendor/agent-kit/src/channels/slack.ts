import { ErrorCode, WebClient } from "@slack/web-api";
import type { WebAPIPlatformError } from "@slack/web-api";
import { IncomingWebhook } from "@slack/webhook";
import * as Effect from "effect/Effect";
import type {
  Channel,
  InboundHandler,
  Outbound,
} from "../core/channels/types.js";
import { ChannelError } from "../core/errors.js";
import type { Health } from "../core/types.js";
import { chunkText, escapeSlackText } from "./chunk.js";
import { SlackSocketListener } from "./slack-socket.js";
import type { SlackChannelDeps, SlackConfig } from "./types.js";

// chat.postMessage accepts up to 40k chars, but long messages render poorly;
// chunk on paragraph/line boundaries well under that (§20 delivery contract).
const SLACK_TEXT_LIMIT = 3900;

// Slack Web API error codes that mean "the token/app is wrong", not "retry".
const AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "no_permission",
  "missing_scope",
]);

// Map a thrown SDK error (or our own ChannelError) onto the channel taxonomy.
const toChannelError = (cause: unknown): ChannelError => {
  if (cause instanceof ChannelError) return cause;
  const code = (cause as { code?: string; } | undefined)?.code;
  if (code === ErrorCode.RateLimitedError) {
    return new ChannelError({
      message: "slack: ratelimited",
      kind: "limit",
      cause,
    });
  }
  if (code === ErrorCode.PlatformError) {
    const error = (cause as WebAPIPlatformError).data?.error
      ?? "platform_error";
    return new ChannelError({
      message: `slack: ${error}`,
      kind: AUTH_ERRORS.has(error) ? "auth" : "delivery",
      cause,
    });
  }
  return new ChannelError({
    message: `slack: ${String(cause)}`,
    kind: "delivery",
    cause,
  });
};

/**
 * Slack adapter — the Effect/Channel port of the api-h12o `slack` notify
 * connector, on the official Slack SDK. Outbound: bot-token mode posts via
 * `WebClient.chat.postMessage` to the channel encoded in the conversationKey
 * (`slack:<channel>`); webhook mode posts via `IncomingWebhook` to a
 * fixed-channel hook. Inbound is delegated to `SlackSocketListener` (Socket
 * Mode, ./slack-socket.ts) and only exists when an `appToken` (or a test
 * socket seam) is configured — otherwise the adapter stays outbound-only.
 */
export class SlackChannel implements Channel {
  readonly name = "slack";
  private readonly postMessage:
    | ((channel: string, text: string) => Promise<void>)
    | undefined;
  private readonly postWebhook: ((text: string) => Promise<void>) | undefined;
  private readonly listener: SlackSocketListener | undefined;

  constructor(private readonly cfg: SlackConfig, deps: SlackChannelDeps = {}) {
    this.postMessage = deps.postMessage ?? defaultPostMessage(cfg);
    this.postWebhook = deps.postWebhook ?? defaultPostWebhook(cfg);
    this.listener = makeListener(cfg, deps);
  }

  // Without an appToken (or test socket) the adapter stays outbound-only.
  async listen(onInbound: InboundHandler): Promise<void> {
    await this.listener?.listen(onInbound);
  }

  send(out: Outbound): Effect.Effect<void, ChannelError> {
    const channel = out.conversationKey.replace(/^slack:/, "");
    return Effect.tryPromise({
      try: () => this.deliver(channel, out.text),
      catch: toChannelError,
    });
  }

  private async deliver(channel: string, text: string): Promise<void> {
    for (const chunk of chunkText(escapeSlackText(text), SLACK_TEXT_LIMIT)) {
      if (this.postMessage) {
        const target = channel || this.cfg.defaultChannel;
        if (!target) {
          throw new ChannelError({
            message:
              "slack: no channel (conversationKey slack:<channel> or defaultChannel)",
            kind: "delivery",
          });
        }
        await this.postMessage(target, chunk);
      } else if (this.postWebhook) {
        await this.postWebhook(chunk);
      } else {
        throw new ChannelError({
          message: "slack: no botToken or webhookUrl configured",
          kind: "auth",
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.listener?.stop();
  }

  async health(): Promise<Health> {
    if (!this.postMessage && !this.postWebhook) {
      return { state: "down", detail: "no botToken or webhookUrl" };
    }
    if (this.listener?.status === "disconnected") {
      return { state: "degraded", detail: "socket mode disconnected" };
    }
    return { state: "ok" };
  }
}

function makeListener(
  cfg: SlackConfig,
  deps: SlackChannelDeps,
): SlackSocketListener | undefined {
  if (!cfg.appToken && !deps.openSocket) return undefined;
  return new SlackSocketListener({
    ...(cfg.appToken !== undefined && { appToken: cfg.appToken }),
    ...(cfg.botToken !== undefined && { botToken: cfg.botToken }),
    ...(cfg.apiBase !== undefined && { apiBase: cfg.apiBase }),
    ...(cfg.ownerId !== undefined && { ownerId: cfg.ownerId }),
    ...(deps.selfId !== undefined && { selfId: deps.selfId }),
    ...(deps.openSocket !== undefined && { openSocket: deps.openSocket }),
  });
}

function defaultPostMessage(
  cfg: SlackConfig,
): ((channel: string, text: string) => Promise<void>) | undefined {
  if (!cfg.botToken) return undefined;
  // Fail fast rather than silently retrying for ~30 min on a rate limit;
  // the caller (and our `limit` taxonomy) decides what to do next.
  const web = new WebClient(cfg.botToken, {
    ...(cfg.apiBase && { slackApiUrl: cfg.apiBase }),
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  });
  return async (channel, text) => {
    await web.chat.postMessage({ channel, text });
  };
}

function defaultPostWebhook(
  cfg: SlackConfig,
): ((text: string) => Promise<void>) | undefined {
  if (!cfg.webhookUrl) return undefined;
  const hook = new IncomingWebhook(cfg.webhookUrl);
  return async (text) => {
    await hook.send({ text });
  };
}
