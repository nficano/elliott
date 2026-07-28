import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { suggestedPrompts } from "../../skills/gateway-slack/src/blocks";
import { SlackWebClient } from "../../skills/gateway-slack/src/client";
import {
  decodeContext,
  decodeInteraction,
  decodeMessage,
  decodeReactionFeedback,
} from "../../skills/gateway-slack/src/events";
import { loadLiveThreadHistory } from "../../skills/gateway-slack/src/history";
import { handleAppHomeOpened } from "../../skills/gateway-slack/src/onboarding";
import { SlackAgentResponse } from "../../skills/gateway-slack/src/response";
import { slackSearchTool } from "../../skills/gateway-slack/src/search";
import type {
  SlackApiClient,
  SlackJson,
} from "../../skills/gateway-slack/src/types";
import { isJsonRecord, nestedRecord } from "../../src/providers/http";

const success = (method: string): SlackJson => {
  if (method === "chat.startStream") return { ok: true, ts: "stream-ts" };
  if (method === "chat.postMessage") return { ok: true, ts: "message-ts" };
  return { ok: true };
};

describe("Slack agent integration", () => {
  it("ships an agent_view manifest with every runtime subscription", async () => {
    const file = path.resolve(
      import.meta.dir,
      "../../skills/gateway-slack/slack-app-manifest.yaml",
    );
    const value: unknown = parse(await readFile(file, "utf8"));
    expect(isJsonRecord(value)).toBe(true);
    if (!isJsonRecord(value)) return;
    const features = nestedRecord(value, "features");
    expect(nestedRecord(features ?? {}, "agent_view")).toBeDefined();
    const settings = nestedRecord(value, "settings");
    const subscriptions = nestedRecord(
      settings ?? {},
      "event_subscriptions",
    );
    expect(subscriptions?.["bot_events"]).toEqual([
      "app_context_changed",
      "app_home_opened",
      "message.im",
      "reaction_added",
    ]);
    expect(settings?.["socket_mode_enabled"]).toBe(true);
  });

  it("retries Slack rate limits using Retry-After", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const client = new SlackWebClient({
      token: "xoxb-test",
      fetcher: async () => {
        attempts += 1;
        return attempts === 1
          ? Response.json(
            { ok: false, error: "ratelimited" },
            { status: 429, headers: { "retry-after": "2" } },
          )
          : Response.json({ ok: true });
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    expect(await client.request("auth.test")).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(delays).toEqual([2000]);
  });

  it("decodes agent-view DM context, attachments, and root threads", () => {
    const context = {
      entities: [{
        type: "slack#/types/message_context",
        value: { channel_id: "C123", message_ts: "123.456" },
        team_id: "T123",
      }],
    };
    const message = decodeMessage(
      {
        type: "message",
        channel: "D123",
        channel_type: "im",
        user: "U123",
        text: "Summarize this",
        ts: "200.001",
        action_token: "action-token",
        app_context: context,
        files: [{ id: "F123", name: "plan.pdf", mimetype: "application/pdf" }],
      },
      [],
      "T123",
    );
    expect(message).toMatchObject({
      channel: "D123",
      thread: "200.001",
      threadRoot: true,
      actionToken: "action-token",
      team: "T123",
      attachments: [{
        id: "F123",
        name: "plan.pdf",
        mediaType: "application/pdf",
      }],
    });
    expect(message?.context).toEqual(decodeContext(context));
  });

  it("decodes channel messages, threading the reply on the source ts", () => {
    // Elliott shares its Slack app with oslo; Socket Mode delivers each event
    // to exactly one agent, so a dropped channel message means NO agent
    // answers it. Channel events must decode like DMs (owner gating lives in
    // the gateway's allowedMessage, not here).
    const message = decodeMessage(
      {
        type: "message",
        channel: "C777",
        channel_type: "channel",
        user: "U123",
        text: "restart the dns container",
        ts: "300.002",
      },
      [],
      "T123",
    );
    expect(message).toMatchObject({
      channel: "C777",
      thread: "300.002",
      threadRoot: true,
      sender: "U123",
      text: "restart the dns container",
    });
  });

  it("decodes owner feedback and delete actions only", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U123" },
      channel: { id: "D123" },
      message: { ts: "300.001" },
      actions: [{ action_id: "elliott_feedback", value: "positive" }],
    };
    expect(decodeInteraction(payload, "U123")).toMatchObject({
      type: "feedback",
      sentiment: "positive",
    });
    expect(decodeInteraction(payload, "U999")).toBeUndefined();
    expect(decodeInteraction({
      ...payload,
      actions: [{ action_id: "elliott_delete", value: "delete" }],
    }, "U123")).toMatchObject({ type: "delete" });
    expect(decodeReactionFeedback(
      {
        type: "reaction_added",
        user: "U123",
        item_user: "UBOT",
        reaction: "thumbsup",
        item: { channel: "D123", ts: "300.001" },
      },
      "U123",
      "UBOT",
    )).toMatchObject({
      sentiment: "positive",
      source: "reaction",
    });
  });

  it("runs the native status, stream, task, and feedback lifecycle", async () => {
    const calls: { readonly method: string; readonly body: SlackJson; }[] = [];
    const client: SlackApiClient = {
      request: async (method, body = {}) => {
        calls.push({ method, body });
        return success(method);
      },
    };
    const response = new SlackAgentResponse({
      client,
      message: {
        id: "D123:400.001",
        gateway: "gateway-slack",
        channel: "D123",
        thread: "400.001",
        threadRoot: true,
        sender: "U123",
        text: "Research the launch",
      },
      report: () => undefined,
    });
    await response.start();
    await response.observer.onTextDelta?.("Here is ");
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "slack_search",
      status: "in_progress",
    });
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "slack_search",
      status: "complete",
    });
    await response.observer.onTextDelta?.("the answer.");
    await response.complete("Here is the answer.");

    expect(calls.map((call) => call.method)).toEqual([
      "assistant.threads.setTitle",
      "assistant.threads.setStatus",
      "chat.startStream",
      "chat.appendStream",
      "chat.appendStream",
      "chat.appendStream",
      "chat.appendStream",
      "chat.stopStream",
      "assistant.threads.setStatus",
    ]);
    const stopped = calls.find((call) => call.method === "chat.stopStream");
    expect(stopped?.body["blocks"]).toBeArray();
  });

  it("onboards only an empty DM and sets contextual prompts", async () => {
    const calls: string[] = [];
    const client: SlackApiClient = {
      request: async (method) => {
        calls.push(method);
        if (method === "conversations.history") {
          return { ok: true, messages: [] };
        }
        return success(method);
      },
    };
    await handleAppHomeOpened({
      client,
      channel: "D123",
      context: [{
        type: "slack#/types/channel_id",
        value: "C123",
      }],
    });
    expect(calls).toEqual([
      "assistant.threads.setSuggestedPrompts",
      "conversations.history",
      "chat.postMessage",
      "assistant.threads.setTitle",
    ]);
    expect(suggestedPrompts([])).toHaveLength(3);
    expect(suggestedPrompts([{
      type: "slack#/types/channel_id",
      value: "C123",
    }])).toHaveLength(4);
  });

  it("searches with the event action token and returns compact citations", async () => {
    let requestBody: SlackJson = {};
    const bot: SlackApiClient = {
      request: async (_method, body = {}) => {
        requestBody = body;
        return {
          ok: true,
          results: {
            messages: [{
              author_name: "Ada",
              channel_name: "launch",
              content: "Ship Friday",
              permalink: "https://example.slack.com/archives/C123/p1",
            }],
          },
        };
      },
    };
    const tool = slackSearchTool({ app: bot, bot });
    const result = await tool.execute({ query: "When do we ship?" }, {
      message: {
        id: "event",
        gateway: "gateway-slack",
        channel: "D123",
        sender: "U123",
        text: "When do we ship?",
        actionToken: "action-token",
        context: [{
          type: "slack#/types/channel_id",
          value: "C123",
        }],
      },
    });
    expect(requestBody).toMatchObject({
      action_token: "action-token",
      context_channel_id: "C123",
      channel_types: ["public_channel"],
    });
    expect(JSON.parse(result)).toMatchObject({
      messages: [{
        content: "Ship Friday",
        permalink: "https://example.slack.com/archives/C123/p1",
      }],
    });
  });

  it("rehydrates thread context live without retaining the current message", async () => {
    const client: SlackApiClient = {
      request: async () => ({
        ok: true,
        messages: [
          { ts: "1.001", user: "U123", text: "Earlier question" },
          { ts: "1.002", bot_id: "B123", text: "Earlier answer" },
          { ts: "1.003", user: "U123", text: "Current question" },
        ],
      }),
    };
    const message = await loadLiveThreadHistory(client, {
      id: "D123:1.003",
      gateway: "gateway-slack",
      channel: "D123",
      thread: "1.001",
      platformId: "1.003",
      sender: "U123",
      text: "Current question",
    });
    expect(message.historyMode).toBe("external");
    expect(message.history).toEqual([
      { sender: "U123", text: "Earlier question" },
      { sender: "bot:B123", text: "Earlier answer" },
    ]);
  });
});
