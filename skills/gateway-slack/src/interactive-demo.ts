import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type { SlackSettings, ToolDefinition } from "../../../src/runtime/types";
import { postMessage } from "./client";
import { CHOICE_ACTION_PREFIX } from "./interactivity";
import type { SlackApiClient, SlackJson } from "./types";

const MAX_OPTIONS = 4;

// The basic interactive message: a prompt plus choice buttons. Clicking a
// button round-trips through whichever interactivity path the Slack app has
// active (Socket Mode frame or the ingress.webhook endpoint) and posts a
// "You picked …" confirmation via the payload's response_url.
export const slackInteractiveTool = (
  settings: SlackSettings,
  client: SlackApiClient,
): ToolDefinition => ({
  name: "slack_send_interactive",
  description: "Post a basic interactive Slack message: a prompt with up to "
    + `${MAX_OPTIONS} choice buttons. When a button is clicked Elliott `
    + "confirms the pick in-channel. Defaults to the owner's primary "
    + "channel; pass channel to target elsewhere.",
  inputSchema: objectSchema({
    text: { type: "string", minLength: 1 },
    options: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: MAX_OPTIONS,
    },
    channel: { type: "string" },
  }, ["text", "options"]),
  execute: async (input) => {
    const text = requiredString(input, "text");
    const options = choiceLabels(input);
    const requested = isJsonRecord(input) ? input["channel"] : undefined;
    const channel = typeof requested === "string" && requested.length > 0
      ? requested
      : settings.defaultChannel;
    await postMessage(client, {
      channel,
      text,
      blocks: choiceBlocks(text, options),
      unfurl_links: false,
      unfurl_media: false,
    });
    return JSON.stringify({ ok: true, channel, options });
  },
});

export const choiceBlocks = (
  text: string,
  options: readonly string[],
): readonly SlackJson[] => [
  { type: "section", text: { type: "mrkdwn", text } },
  {
    type: "actions",
    block_id: "elliott_interactive_choices",
    elements: options.map((label, index) => ({
      type: "button",
      action_id: `${CHOICE_ACTION_PREFIX}_${index}`,
      text: { type: "plain_text", text: label },
      value: label,
    })),
  },
];

const choiceLabels = (input: unknown): readonly string[] => {
  const value = isJsonRecord(input) ? input["options"] : undefined;
  if (!Array.isArray(value)) {
    throw new TypeError("Tool argument options must be an array of labels");
  }
  const labels = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (labels.length === 0 || labels.length > MAX_OPTIONS) {
    throw new Error(`options needs 1-${MAX_OPTIONS} non-empty labels`);
  }
  return labels;
};
