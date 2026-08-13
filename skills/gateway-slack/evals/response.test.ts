import { describe, expect, test } from "bun:test";
import type { InboundMessage } from "../../../src/runtime/types";
import { SlackAgentResponse } from "../src/response";
import type { SlackApiClient, SlackJson } from "../src/types";

// Slack streams are locked to a single content mode by their first payload:
// task/plan chunks or markdown text, never both — the other kind fails with
// streaming_mode_mismatch, and channel streams refuse to start without the
// recipient pair. These tests pin the response to the verified-good shapes.

class RecordingClient implements SlackApiClient {
  readonly calls: { method: string; body: SlackJson; }[] = [];
  readonly #responses: Readonly<Record<string, SlackJson | Error>>;

  constructor(responses: Readonly<Record<string, SlackJson | Error>> = {}) {
    this.#responses = responses;
  }

  request(method: string, body: SlackJson = {}): Promise<SlackJson> {
    this.calls.push({ method, body });
    const scripted = this.#responses[method];
    if (scripted instanceof Error) return Promise.reject(scripted);
    return Promise.resolve(scripted ?? { ok: true });
  }

  of(method: string): readonly SlackJson[] {
    return this.calls
      .filter((call) => call.method === method)
      .map((call) => call.body);
  }
}

const channelMessage: InboundMessage = {
  id: "C1:1.1",
  gateway: "slack",
  channel: "C1",
  thread: "1.1",
  threadRoot: true,
  platformId: "1.1",
  sender: "U1",
  text: "hello there",
  team: "T1",
};

const directMessage: InboundMessage = {
  ...channelMessage,
  id: "D1:1.1",
  channel: "D1",
};

const makeResponse = (
  message: InboundMessage,
  responses: Readonly<Record<string, SlackJson | Error>> = {},
) => {
  const client = new RecordingClient({
    "chat.startStream": { ok: true, ts: "9.9" },
    ...responses,
  });
  const response = new SlackAgentResponse({
    client,
    message,
    report: () => {},
    replyInThread: false,
  });
  return { client, response };
};

describe("start", () => {
  test("channel streams start bare with the recipient pair", async () => {
    const { client, response } = makeResponse(channelMessage);
    await response.start();
    const [started] = client.of("chat.startStream");
    expect(started?.["recipient_team_id"]).toBe("T1");
    expect(started?.["recipient_user_id"]).toBe("U1");
    // Any chunk (plan_update included) locks the stream into task mode and
    // every markdown_text append after it fails streaming_mode_mismatch.
    expect(started?.["chunks"]).toBeUndefined();
    expect(started?.["task_display_mode"]).toBeUndefined();
    // reply_in_thread=false answers top-level channel messages in-channel.
    expect(started?.["thread_ts"]).toBeUndefined();
  });

  test("channel messages never touch the assistant surface", async () => {
    const { client, response } = makeResponse(channelMessage);
    await response.start();
    expect(client.of("assistant.threads.setTitle")).toHaveLength(0);
    expect(client.of("assistant.threads.setStatus")).toHaveLength(0);
  });

  test("DM streams thread, keep the assistant surface, omit recipients", async () => {
    const { client, response } = makeResponse(directMessage);
    await response.start();
    const [started] = client.of("chat.startStream");
    expect(started?.["thread_ts"]).toBe("1.1");
    expect(started?.["recipient_team_id"]).toBeUndefined();
    expect(started?.["chunks"]).toBeUndefined();
    expect(client.of("assistant.threads.setTitle")).toHaveLength(1);
    expect(client.of("assistant.threads.setStatus")).toHaveLength(1);
  });

  test("channel messages without a team fall back to a bare start", async () => {
    const withoutTeam = Object.fromEntries(
      Object.entries(channelMessage).filter(([key]) => key !== "team"),
    ) as InboundMessage;
    const { client, response } = makeResponse(withoutTeam);
    await response.start();
    const [started] = client.of("chat.startStream");
    expect(started?.["recipient_team_id"]).toBeUndefined();
    expect(started?.["recipient_user_id"]).toBeUndefined();
  });
});

describe("streaming text", () => {
  test("deltas append as top-level markdown_text, never as chunks", async () => {
    const { client, response } = makeResponse(directMessage);
    await response.start();
    await response.observer.onTextDelta?.("streamed answer ");
    await response.complete("streamed answer ");
    const appends = client.of("chat.appendStream");
    expect(appends.length).toBeGreaterThan(0);
    for (const body of appends) {
      expect(typeof body["markdown_text"]).toBe("string");
      expect(body["chunks"]).toBeUndefined();
    }
  });

  test("stop finalizes with footer blocks and no chunks", async () => {
    const { client, response } = makeResponse(directMessage);
    await response.start();
    await response.observer.onTextDelta?.("answer");
    await response.complete("answer");
    const [stopped] = client.of("chat.stopStream");
    expect(stopped).toBeDefined();
    expect(stopped?.["chunks"]).toBeUndefined();
    expect(Array.isArray(stopped?.["blocks"])).toBe(true);
  });
});

describe("tool progress", () => {
  test("never rides the stream as task_update chunks", async () => {
    const { client, response } = makeResponse(directMessage);
    await response.start();
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "web_search",
      status: "in_progress",
    });
    for (const body of client.of("chat.appendStream")) {
      expect(body["chunks"]).toBeUndefined();
    }
  });

  test("surfaces through the DM assistant status line", async () => {
    const { client, response } = makeResponse(directMessage);
    await response.start();
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "web_search",
      status: "in_progress",
    });
    const statuses = client.of("assistant.threads.setStatus");
    const latest = statuses.at(-1);
    expect(String(latest?.["status"])).toContain("web search");
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "web_search",
      status: "complete",
    });
    const after = client.of("assistant.threads.setStatus");
    expect(String(after.at(-1)?.["status"])).toBe("Thinking…");
  });

  test("stays silent in channels (no assistant surface there)", async () => {
    const { client, response } = makeResponse(channelMessage);
    await response.start();
    await response.observer.onToolProgress?.({
      id: "call-1",
      name: "web_search",
      status: "in_progress",
    });
    expect(client.of("assistant.threads.setStatus")).toHaveLength(0);
    for (const body of client.of("chat.appendStream")) {
      expect(body["chunks"]).toBeUndefined();
    }
  });
});

describe("fallback", () => {
  test("a failed stream start still delivers via chat.postMessage", async () => {
    const { client, response } = makeResponse(channelMessage, {
      "chat.startStream": new Error("missing_recipient_team_id"),
      "chat.postMessage": { ok: true, ts: "2.2" },
    });
    await response.start();
    await response.complete("the answer");
    const [posted] = client.of("chat.postMessage");
    expect(posted?.["text"]).toBe("the answer");
  });
});
