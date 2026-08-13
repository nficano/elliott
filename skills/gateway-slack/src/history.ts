import { recordArray } from "../../../src/providers/http";
import type {
  InboundMessage,
  InboundThreadMessage,
} from "../../../src/runtime/types";
import type { SlackApiClient } from "./types";

const THREAD_HISTORY_LIMIT = 100;
const MODEL_HISTORY_MESSAGES = 40;

export const loadLiveThreadHistory = async (
  client: SlackApiClient,
  message: InboundMessage,
): Promise<InboundMessage> => {
  const response = await client.request("conversations.replies", {
    channel: message.channel,
    ts: message.thread ?? message.platformId,
    limit: THREAD_HISTORY_LIMIT,
  });
  const history = recordArray(response, "messages")
    .filter((item) => item["ts"] !== message.platformId)
    .flatMap(decodeThreadMessage)
    .slice(-MODEL_HISTORY_MESSAGES);
  return { ...message, history, historyMode: "external" };
};

export const withoutRetainedHistory = (
  message: InboundMessage,
): InboundMessage => ({ ...message, historyMode: "external" });

const decodeThreadMessage = (
  item: Readonly<Record<string, unknown>>,
): readonly InboundThreadMessage[] => {
  const text = item["text"];
  if (typeof text !== "string" || text.length === 0) return [];
  const user = item["user"];
  const bot = item["bot_id"];
  const sender = threadSender(user, bot);
  return [{ sender, text }];
};

const threadSender = (user: unknown, bot: unknown): string => {
  if (typeof user === "string") return user;
  return typeof bot === "string" ? `bot:${bot}` : "unknown";
};
