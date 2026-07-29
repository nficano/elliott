import { isJsonRecord } from "../../../../src/providers/http";
import {
  objectSchema,
  requiredString,
} from "../../../../src/runtime/skills/http";
import type {
  SlackSettings,
  ToolDefinition,
} from "../../../../src/runtime/types";
import { withResponseFooters } from "./blocks";
import { postMessage } from "./client";
import type { SlackApiClient, SlackJson } from "./types";

const MAX_CUSTOM_BLOCKS = 48;

export const slackMessageTool = (
  settings: SlackSettings,
  client: SlackApiClient,
): ToolDefinition => ({
  name: "slack_message",
  description:
    "Post a formatted or interactive Block Kit message to Slack. Reach for this "
    + "over a plain reply when structure or interaction beats prose: approvals or "
    + "choices (buttons, select menus in an actions block), grouped data "
    + "(section fields, tables), or a scannable summary (header + divider + "
    + "context). Supply Block Kit `blocks` plus a plain `text` fallback "
    + "(notifications use it). Inside section/context text use Slack mrkdwn "
    + "(*bold*, _italic_, <url|label>) — standard markdown only renders inside a "
    + "markdown block. Every interactive control needs a text label, not color "
    + "alone. Defaults to the owner's primary channel; pass channel/thread to "
    + "target elsewhere. Displayed text may use only Elliott's approved custom "
    + "emoji aliases; every other shortcode or Unicode emoji is removed. See "
    + "docs/slack-llms.txt for the block catalog, interactivity, and formatting "
    + "rules.",
  inputSchema: objectSchema({
    text: { type: "string", minLength: 1 },
    blocks: { type: "array", items: { type: "object" }, minItems: 1 },
    channel: { type: "string" },
    thread: { type: "string" },
  }, ["text", "blocks"]),
  execute: async (input) => {
    const text = requiredString(input, "text");
    const blocks = blockList(input);
    const record = isJsonRecord(input) ? input : {};
    const requested = record["channel"];
    const channel = typeof requested === "string" && requested.length > 0
      ? requested
      : settings.defaultChannel;
    const thread = record["thread"];
    await postMessage(client, {
      channel,
      text,
      blocks: withResponseFooters(blocks),
      ...(typeof thread === "string" && { thread_ts: thread }),
      unfurl_links: false,
      unfurl_media: false,
    });
    return JSON.stringify({ ok: true, channel, blocks: blocks.length });
  },
});

const blockList = (input: unknown): readonly SlackJson[] => {
  const value = isJsonRecord(input) ? input["blocks"] : undefined;
  if (!Array.isArray(value)) {
    throw new TypeError("Tool argument blocks must be an array of blocks");
  }
  const blocks = value.filter(isJsonRecord);
  if (blocks.length === 0) {
    throw new Error("blocks must contain at least one Block Kit block");
  }
  if (blocks.length > MAX_CUSTOM_BLOCKS) {
    throw new Error(
      `blocks cannot contain more than ${MAX_CUSTOM_BLOCKS} items`,
    );
  }
  for (const block of blocks) {
    if (typeof block["type"] !== "string") {
      throw new TypeError("Each block needs a string `type`");
    }
  }
  return blocks;
};
