import { isJsonRecord } from "../../../src/providers/http";
import type { SlackJson } from "./types";

export const SLACK_API = "https://slack.com/api";

export const slackRequest = async (
  method: string,
  token: string,
  body?: SlackJson,
): Promise<SlackJson> => {
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

export const postMessage = async (
  token: string,
  args: SlackJson,
): Promise<void> => {
  const response = await slackRequest("chat.postMessage", token, args);
  if (response["ok"] !== true) {
    throw new Error(`Slack delivery failed: ${String(response["error"])}`);
  }
};

// Wrap standard markdown in a Block Kit markdown block so Slack translates it
// correctly. LLM output is standard markdown by default, which renders as
// literal asterisks/brackets in a plain mrkdwn message; the markdown block is
// the safe target (see docs/slack-llms.txt §3).
export const markdownBlock = (text: string): SlackJson => ({
  type: "markdown",
  text,
});
