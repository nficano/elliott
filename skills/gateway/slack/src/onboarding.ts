import { recordArray } from "../../../../src/providers/http";
import { suggestedPrompts, welcomeBlocks } from "./blocks";
import { postMessage } from "./client";
import type { SlackAppHomeOptions } from "./types";

const WELCOME_TEXT =
  "Elliott is ready. Ask me to research, plan, use connected tools, or work from what you're viewing in Slack.";

export const handleAppHomeOpened = async (
  options: SlackAppHomeOptions,
): Promise<void> => {
  await options.client.request("assistant.threads.setSuggestedPrompts", {
    channel_id: options.channel,
    title: "Try asking Elliott",
    prompts: suggestedPrompts(options.context),
  });
  if (!await isFirstInteraction(options)) return;
  const thread = await postMessage(options.client, {
    channel: options.channel,
    text: WELCOME_TEXT,
    blocks: welcomeBlocks(),
    unfurl_links: false,
    unfurl_media: false,
  });
  await options.client.request("assistant.threads.setTitle", {
    channel_id: options.channel,
    thread_ts: thread,
    title: "Welcome to Elliott",
  });
};

const isFirstInteraction = async (
  options: SlackAppHomeOptions,
): Promise<boolean> => {
  const history = await options.client.request("conversations.history", {
    channel: options.channel,
    limit: 1,
  });
  return recordArray(history, "messages").length === 0;
};
