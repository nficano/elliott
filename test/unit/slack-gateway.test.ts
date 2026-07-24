import { describe, expect, it } from "bun:test";
import {
  DELETE_ACTION_ID,
  FEEDBACK_ACTION_ID,
  responseFooterBlocks,
  withResponseFooters,
} from "../../skills/gateway-slack/src/blocks";
import {
  ALLOWED_SLACK_EMOJI,
  sanitizeSlackDisplayPayload,
  sanitizeSlackEmoji,
  SlackEmojiStreamFilter,
} from "../../skills/gateway-slack/src/emoji";
import {
  decodeInteraction,
  decodeReactionFeedback,
} from "../../skills/gateway-slack/src/events";
import { slackMessageTool } from "../../skills/gateway-slack/src/message";
import type {
  SlackApiClient,
  SlackJson,
} from "../../skills/gateway-slack/src/types";

const OWNER = "UOWNER";

describe("Slack Block Kit interactions", () => {
  it("allows only the approved emoji aliases in displayed Slack text", () => {
    expect(sanitizeSlackEmoji(ALLOWED_SLACK_EMOJI.join(" "))).toBe(
      ALLOWED_SLACK_EMOJI.join(" "),
    );
    expect(sanitizeSlackEmoji(
      "Done ✅ :white_check_mark: 🚀 :rocket: ⚠️ :eyes:",
    )).toBe(
      "Done :status-ok: :status-ok: :circle-upload: :circle-upload: "
        + ":triangle-warn: ",
    );
    expect(sanitizeSlackDisplayPayload({
      query: "find 🚀",
      text: "Ship 🚀",
      blocks: [{
        type: "section",
        text: { type: "mrkdwn", text: "Done ✅ :eyes:" },
      }],
    })).toEqual({
      query: "find 🚀",
      text: "Ship :circle-upload:",
      blocks: [{
        type: "section",
        text: { type: "mrkdwn", text: "Done :status-ok: " },
      }],
    });
  });

  it("filters emoji shortcodes split across streaming chunks", () => {
    const filter = new SlackEmojiStreamFilter();
    expect(filter.push("Working :roc")).toEqual({
      text: "Working ",
      sourceLength: 8,
    });
    expect(filter.push("ket: then :status-")).toEqual({
      text: ":circle-upload: then ",
      sourceLength: 14,
    });
    expect(filter.push("ok:")).toEqual({
      text: ":status-ok:",
      sourceLength: 11,
    });
    expect(filter.finish()).toEqual({ text: "", sourceLength: 0 });
  });

  it("decodes owner feedback and delete buttons while rejecting other users", () => {
    const base = {
      type: "block_actions",
      user: { id: OWNER },
      channel: { id: "C123" },
      message: { ts: "123.456" },
    };
    expect(decodeInteraction({
      ...base,
      actions: [{
        action_id: FEEDBACK_ACTION_ID,
        value: "positive",
      }],
    }, OWNER)).toEqual({
      type: "feedback",
      channel: "C123",
      message: "123.456",
      sender: OWNER,
      sentiment: "positive",
    });
    expect(decodeInteraction({
      ...base,
      actions: [{ action_id: DELETE_ACTION_ID, value: "delete" }],
    }, OWNER)).toEqual({
      type: "delete",
      channel: "C123",
      message: "123.456",
      sender: OWNER,
    });
    expect(decodeInteraction({
      ...base,
      user: { id: "UOTHER" },
      actions: [{
        action_id: FEEDBACK_ACTION_ID,
        value: "negative",
      }],
    }, OWNER)).toBeUndefined();
  });

  it("maps owner reactions on Elliott messages to feedback", () => {
    expect(decodeReactionFeedback(
      {
        type: "reaction_added",
        user: OWNER,
        item_user: "UBOT",
        reaction: "thumbsup",
        item: { channel: "C123", ts: "123.456" },
      },
      OWNER,
      "UBOT",
    )).toEqual({
      gateway: "gateway-slack",
      channel: "C123",
      message: "123.456",
      sender: OWNER,
      sentiment: "positive",
      source: "reaction",
    });
  });

  it("posts select menus and adds the standard response controls", async () => {
    const requests: Array<{
      readonly method: string;
      readonly body: SlackJson;
    }> = [];
    const client: SlackApiClient = {
      request: async (method, body = {}) => {
        requests.push({ method, body });
        return { ok: true, ts: "123.456" };
      },
    };
    const tool = slackMessageTool({
      appToken: "xapp-test",
      botToken: "xoxb-test",
      ownerId: OWNER,
      defaultChannel: "#the-end",
    }, client);
    const menu = {
      type: "actions",
      elements: [{
        type: "static_select",
        action_id: "elliott_test_choice",
        placeholder: { type: "plain_text", text: "Choose one" },
        options: [{
          text: { type: "plain_text", text: "First" },
          value: "first",
        }],
      }],
    };

    expect(JSON.parse(
      await tool.execute({
        text: "Choose one",
        blocks: [menu],
      }),
    )).toEqual({ ok: true, channel: "#the-end", blocks: 1 });
    expect(requests).toEqual([{
      method: "chat.postMessage",
      body: {
        channel: "#the-end",
        text: "Choose one",
        blocks: withResponseFooters([menu]),
        unfurl_links: false,
        unfurl_media: false,
      },
    }]);
    expect(responseFooterBlocks()).toHaveLength(2);
  });
});
