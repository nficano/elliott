import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../../src/providers/http";
import type { GatewayFeedback } from "../../../../src/runtime/skills/types";
import type {
  InboundAttachment,
  InboundContextEntity,
  InboundMessage,
} from "../../../../src/runtime/types";
import { DELETE_ACTION_ID, FEEDBACK_ACTION_ID } from "./blocks";
import { GATEWAY_NAME } from "./constants";
import type { SlackInteraction, SlackJson } from "./types";

export const decodeContext = (
  value: unknown,
): readonly InboundContextEntity[] => {
  if (!isJsonRecord(value)) return [];
  return recordArray(value, "entities").flatMap((entity) => {
    const type = entity["type"];
    const raw = entity["value"];
    const decoded = typeof raw === "string" ? raw : contextRecord(raw);
    if (typeof type !== "string" || decoded === undefined) return [];
    const teamId = entity["team_id"];
    return [{
      type,
      value: decoded,
      ...(typeof teamId === "string" && { teamId }),
    }];
  });
};

export const decodeMessage = (
  event: SlackJson,
  fallbackContext: readonly InboundContextEntity[],
  team: string | undefined,
): InboundMessage | undefined => {
  const fields = messageFields(event);
  if (fields === undefined) return undefined;
  const explicitThread = event["thread_ts"];
  const context = decodeContext(event["app_context"]);
  const attachments = decodeAttachments(event["files"]);
  return {
    id: `${fields.channel}:${fields.timestamp}`,
    gateway: GATEWAY_NAME,
    channel: fields.channel,
    thread: typeof explicitThread === "string"
      ? explicitThread
      : fields.timestamp,
    threadRoot: typeof explicitThread !== "string",
    platformId: fields.timestamp,
    sender: fields.sender,
    text: fields.text,
    ...optionalTeam(team),
    ...optionalActionToken(event["action_token"]),
    ...optionalContext(context, fallbackContext),
    ...optionalAttachments(attachments),
  };
};

export const decodeInteraction = (
  payload: SlackJson,
  ownerId: string,
): SlackInteraction | undefined => {
  if (payload["type"] !== "block_actions") return undefined;
  const coordinates = interactionCoordinates(payload, ownerId);
  if (coordinates === undefined) return undefined;
  const action = recordArray(payload, "actions")[0];
  const actionId = action?.["action_id"];
  if (typeof actionId !== "string") return undefined;
  if (actionId === DELETE_ACTION_ID) {
    return { type: "delete", ...coordinates };
  }
  const value = action?.["value"];
  if (
    actionId !== FEEDBACK_ACTION_ID
    || (value !== "positive" && value !== "negative")
  ) return undefined;
  return { type: "feedback", ...coordinates, sentiment: value };
};

export const decodeReactionFeedback = (
  event: SlackJson,
  ownerId: string,
  selfId: string | undefined,
): GatewayFeedback | undefined => {
  if (!isOwnerReaction(event, ownerId, selfId)) return undefined;
  const sentiment = reactionSentiment(event["reaction"]);
  const item = nestedRecord(event, "item");
  const channel = item?.["channel"];
  const message = item?.["ts"];
  if (
    sentiment === undefined || typeof channel !== "string"
    || typeof message !== "string"
  ) return undefined;
  return {
    gateway: GATEWAY_NAME,
    channel,
    message,
    sender: ownerId,
    sentiment,
    source: "reaction",
  };
};

const contextRecord = (
  value: unknown,
): Readonly<Record<string, string>> | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const messageFields = (event: SlackJson) => {
  const channel = event["channel"];
  const sender = event["user"];
  const text = event["text"];
  const timestamp = event["ts"];
  if (
    typeof channel !== "string" || typeof sender !== "string"
    || typeof text !== "string" || typeof timestamp !== "string"
  ) return undefined;
  return { channel, sender, text, timestamp };
};

const optionalTeam = (
  value: unknown,
): { readonly team?: string; } =>
  typeof value === "string" ? { team: value } : {};

const optionalActionToken = (
  value: unknown,
): { readonly actionToken?: string; } =>
  typeof value === "string" ? { actionToken: value } : {};

const optionalContext = (
  explicit: readonly InboundContextEntity[],
  fallback: readonly InboundContextEntity[],
): { readonly context?: readonly InboundContextEntity[]; } => {
  if (explicit.length > 0) return { context: explicit };
  return fallback.length > 0 ? { context: fallback } : {};
};

const optionalAttachments = (
  attachments: readonly InboundAttachment[],
): { readonly attachments?: readonly InboundAttachment[]; } =>
  attachments.length > 0 ? { attachments } : {};

const decodeAttachments = (value: unknown): readonly InboundAttachment[] =>
  Array.isArray(value) ? value.flatMap(decodeAttachment) : [];

const decodeAttachment = (value: unknown): readonly InboundAttachment[] => {
  if (!isJsonRecord(value)) return [];
  const id = value["id"];
  if (typeof id !== "string") return [];
  const name = value["name"];
  return [{
    id,
    name: typeof name === "string" ? name : id,
    mediaType: attachmentMediaType(value["mimetype"], value["filetype"]),
  }];
};

const attachmentMediaType = (mediaType: unknown, fileType: unknown): string => {
  if (typeof mediaType === "string") return mediaType;
  if (typeof fileType === "string") return fileType;
  return "application/octet-stream";
};

const interactionCoordinates = (payload: SlackJson, ownerId: string) => {
  const sender = nestedRecord(payload, "user")?.["id"];
  if (sender !== ownerId) return undefined;
  const channel = interactionChannel(payload);
  const message = interactionMessage(payload);
  return channel === undefined || message === undefined
    ? undefined
    : { channel, message, sender };
};

const interactionChannel = (payload: SlackJson): string | undefined => {
  const channel = nestedRecord(payload, "channel")?.["id"]
    ?? nestedRecord(payload, "container")?.["channel_id"];
  return typeof channel === "string" ? channel : undefined;
};

const interactionMessage = (payload: SlackJson): string | undefined => {
  const message = nestedRecord(payload, "message")?.["ts"]
    ?? nestedRecord(payload, "container")?.["message_ts"];
  return typeof message === "string" ? message : undefined;
};

const isOwnerReaction = (
  event: SlackJson,
  ownerId: string,
  selfId: string | undefined,
): boolean =>
  event["type"] === "reaction_added" && event["user"] === ownerId
  && selfId !== undefined && event["item_user"] === selfId;

const reactionSentiment = (
  reaction: unknown,
): "positive" | "negative" | undefined => {
  if (
    reaction === "thumbsup" || reaction === "+1"
    || reaction === "white_check_mark"
  ) return "positive";
  if (
    reaction === "thumbsdown" || reaction === "-1" || reaction === "x"
  ) return "negative";
  return undefined;
};
