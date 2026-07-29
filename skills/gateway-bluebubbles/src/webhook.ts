import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../src/providers/http";
import { verifiedRequestToken } from "../../../src/runtime/skills/http";
import type {
  GatewayBinding,
  GatewayEvents,
  RouteBinding,
  SkillContext,
} from "../../../src/runtime/skills/types";
import type {
  BlueBubblesSettings,
  InboundMessage,
} from "../../../src/runtime/types";
import {
  createBlueBubblesClient,
  identifiersMatch,
  messageBody,
} from "./client";
import type { BlueBubblesJson } from "./types";

export const GATEWAY_NAME = "gateway-bluebubbles";

const ROUTE_PATH = "/v1/gateways/bluebubbles";
const DIRECT_CHAT_MARKER = ";-;";
const MAX_BODY_BYTES = 262_144;
const HTTP_ACCEPTED = 202;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;

// Inbound iMessage is only accepted once senders are explicitly allowlisted;
// the webhook stays unregistered without both a shared token and a sender.
export const webhookEnabled = (settings: BlueBubblesSettings): boolean =>
  settings.webhookSecret !== undefined
  && allowedSenders(settings).length > 0;

// BlueBubbles webhooks carry no signature, so the registered URL embeds a
// shared token (`?token=<bluebubbles_webhook_secret>`) that is verified in
// constant time before any payload is inspected.
export const bluebubblesWebhookRoute = (
  settings: BlueBubblesSettings,
  context: SkillContext,
): RouteBinding => ({
  method: "POST",
  path: ROUTE_PATH,
  handle: async (request, events) => {
    const secret = settings.webhookSecret;
    if (secret === undefined || !verifiedRequestToken(request, secret)) {
      context.report(
        new Error("BlueBubbles webhook failed token verification"),
        "bluebubbles:ingress",
      );
      return new Response("Invalid token", { status: HTTP_UNAUTHORIZED });
    }
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return new Response("Payload too large", {
        status: HTTP_PAYLOAD_TOO_LARGE,
      });
    }
    return dispatch(settings, body, events);
  },
});

// Replies to accepted iMessages go back to the chat they came from: the
// runtime resolves this binding by name (message.gateway) and calls send with
// the chat GUID as the channel. No defaultChannel is exposed on purpose, so a
// configured chat gateway (Slack) keeps owning broadcast delivery.
export const bluebubblesReplyGateway = (
  settings: BlueBubblesSettings,
  fetcher?: typeof fetch,
): GatewayBinding => ({
  name: GATEWAY_NAME,
  status: () => "webhook",
  start: async () => {},
  stop: () => {},
  send: async (channel, text) => {
    const target = channel.length > 0 ? channel : settings.defaultRecipient;
    if (target === undefined || target.length === 0) {
      throw new Error("BlueBubbles reply has no target chat");
    }
    // The client is built per send so an injected (or test-stubbed) global
    // fetch is resolved at delivery time, not at registration time.
    await createBlueBubblesClient(settings, fetcher).sendText(target, text);
  },
});

const dispatch = (
  settings: BlueBubblesSettings,
  body: string,
  events: GatewayEvents,
): Response => {
  const event = parseEvent(body);
  if (event === undefined) {
    return new Response("Invalid payload", { status: HTTP_BAD_REQUEST });
  }
  const message = event.type === "new-message"
    ? decodeInbound(settings, event.data)
    : undefined;
  if (message === undefined) {
    return Response.json({ accepted: false }, { status: HTTP_ACCEPTED });
  }
  void events.onMessage(message).catch(events.onError);
  return Response.json({ accepted: true }, { status: HTTP_ACCEPTED });
};

const parseEvent = (
  body: string,
): { readonly type: string; readonly data: BlueBubblesJson; } | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isJsonRecord(value)) return undefined;
  const type = value["type"];
  const data = value["data"];
  if (typeof type !== "string" || !isJsonRecord(data)) return undefined;
  return { type, data };
};

// Accept only what the agent should react to: an incoming (not self-sent,
// not tapback) message in a direct 1:1 chat from an allowlisted sender.
// Everything else is acknowledged and dropped.
const decodeInbound = (
  settings: BlueBubblesSettings,
  data: BlueBubblesJson,
): InboundMessage | undefined => {
  if (data["isFromMe"] === true) return undefined;
  if (isTapback(data)) return undefined;
  const sender = senderAddress(data);
  if (sender === undefined || !senderAllowed(settings, sender)) {
    return undefined;
  }
  const channel = chatGuid(data, sender);
  if (!channel.includes(DIRECT_CHAT_MARKER)) return undefined;
  const text = messageBody(data);
  if (text.length === 0) return undefined;
  const guid = data["guid"];
  return {
    id: `bluebubbles:${
      typeof guid === "string" && guid.length > 0
        ? guid
        : crypto.randomUUID()
    }`,
    gateway: GATEWAY_NAME,
    channel,
    sender,
    text,
  };
};

// Tapbacks (reactions) reference the message they decorate; treating them as
// fresh inbound turns would have the agent answering "Loved …" noise.
const isTapback = (data: BlueBubblesJson): boolean => {
  const associated = data["associatedMessageGuid"];
  return typeof associated === "string" && associated.length > 0;
};

const senderAddress = (data: BlueBubblesJson): string | undefined => {
  const handle = nestedRecord(data, "handle");
  if (handle === undefined) return undefined;
  const address = handle["address"];
  return typeof address === "string" && address.length > 0
    ? address
    : undefined;
};

const senderAllowed = (
  settings: BlueBubblesSettings,
  sender: string,
): boolean =>
  allowedSenders(settings).some((allowed) => identifiersMatch(allowed, sender));

const allowedSenders = (
  settings: BlueBubblesSettings,
): readonly string[] =>
  [settings.defaultRecipient, ...settings.allowedRecipients].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );

const chatGuid = (data: BlueBubblesJson, sender: string): string => {
  const chat = recordArray(data, "chats")[0];
  const guid = chat?.["guid"];
  return typeof guid === "string" && guid.length > 0
    ? guid
    : `iMessage${DIRECT_CHAT_MARKER}${sender}`;
};
