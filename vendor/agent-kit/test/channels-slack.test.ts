import { ErrorCode } from "@slack/web-api";
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { SlackChannel } from "../src/channels/slack.js";
import type { SlackSocketHandlers } from "../src/channels/types.js";
import type { Inbound } from "../src/core/channels/types.js";
import type { ChannelError } from "../src/core/errors.js";

async function runFail(
  eff: Effect.Effect<unknown, ChannelError>,
): Promise<ChannelError> {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) {
    throw new Error("expected failure, got success");
  }
  return result.failure;
}

describe("SlackChannel (ported api-h12o connector, official SDK)", () => {
  test("bot mode posts to the key's channel with entity escaping", async () => {
    const calls: Array<{ chan: string; text: string; }> = [];
    const channel = new SlackChannel(
      { botToken: "xoxb-x" },
      { postMessage: async (chan, text) => void calls.push({ chan, text }) },
    );

    await Effect.runPromise(
      channel.send({ conversationKey: "slack:#alerts", text: "a <b> & c" }),
    );

    // & < > are entity-escaped so literal brackets survive Slack mrkdwn.
    expect(calls).toEqual([{ chan: "#alerts", text: "a &lt;b&gt; &amp; c" }]);
  });

  test("falls back to defaultChannel when the key carries none", async () => {
    const calls: Array<{ chan: string; text: string; }> = [];
    const channel = new SlackChannel(
      { botToken: "xoxb-x", defaultChannel: "#ops" },
      { postMessage: async (chan, text) => void calls.push({ chan, text }) },
    );

    await Effect.runPromise(
      channel.send({ conversationKey: "slack:", text: "hi" }),
    );
    expect(calls[0].chan).toBe("#ops");
  });

  test("a platform auth error maps to a non-retryable auth failure", async () => {
    const channel = new SlackChannel(
      { botToken: "xoxb-bad" },
      {
        postMessage: () =>
          Promise.reject(Object.assign(new Error("platform"), {
            code: ErrorCode.PlatformError,
            data: { ok: false, error: "invalid_auth" },
          })),
      },
    );

    const error = await runFail(
      channel.send({ conversationKey: "slack:#c", text: "x" }),
    );
    expect(error.kind).toBe("auth");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("invalid_auth");
  });

  test("a rate-limit error maps to a retryable limit failure", async () => {
    const channel = new SlackChannel(
      { botToken: "xoxb-x" },
      {
        postMessage: () =>
          Promise.reject(Object.assign(new Error("rate"), {
            code: ErrorCode.RateLimitedError,
          })),
      },
    );

    const error = await runFail(
      channel.send({ conversationKey: "slack:#c", text: "x" }),
    );
    expect(error.kind).toBe("limit");
    expect(error.retryable).toBe(true);
  });

  test("webhook mode delivers text and needs no channel", async () => {
    const sent: string[] = [];
    const channel = new SlackChannel(
      { webhookUrl: "https://hooks.example/abc" },
      { postWebhook: async (text) => void sent.push(text) },
    );

    await Effect.runPromise(
      channel.send({ conversationKey: "slack:#ignored", text: "ping" }),
    );
    expect(sent).toEqual(["ping"]);
  });

  test("no channel + no default is a delivery failure", async () => {
    const channel = new SlackChannel(
      { botToken: "xoxb-x" },
      { postMessage: async () => {} },
    );

    const error = await runFail(
      channel.send({ conversationKey: "slack:", text: "x" }),
    );
    expect(error.kind).toBe("delivery");
    expect(error.message).toContain("no channel");
  });

  test("health is down when neither credential is set", async () => {
    const channel = new SlackChannel({});
    expect((await channel.health()).state).toBe("down");
  });
});

describe("SlackChannel Socket Mode inbound", () => {
  const envelope = (event: Record<string, unknown>): string =>
    JSON.stringify({
      type: "events_api",
      envelope_id: "env-1",
      payload: { event },
    });

  function socketHarness() {
    const sent: string[] = [];
    let handlers: SlackSocketHandlers | undefined;
    const openSocket = async (h: SlackSocketHandlers) => {
      handlers = h;
      return {
        send: (d: string) => void sent.push(d),
        close: () => h.onClose(),
      };
    };
    return {
      sent,
      openSocket,
      frame: (raw: string) => handlers.onFrame(raw),
      drop: () => handlers.onClose(),
    };
  }

  async function listening(harness: ReturnType<typeof socketHarness>) {
    const inbounds: Inbound[] = [];
    const channel = new SlackChannel(
      { botToken: "xoxb-x", appToken: "xapp-x", ownerId: "U-OWNER" },
      {
        postMessage: async () => {},
        openSocket: harness.openSocket,
        selfId: "U-SELF",
      },
    );
    await channel.listen(async (m) => void inbounds.push(m));
    await Bun.sleep(1); // let connectOnce run
    return { channel, inbounds };
  }

  test("acks envelopes and maps an owner message to Inbound", async () => {
    const harness = socketHarness();
    const { channel, inbounds } = await listening(harness);

    harness.frame(envelope({
      type: "message",
      text: "hello oslo",
      user: "U-OWNER",
      channel: "C123",
      ts: "1784738900.000100",
    }));
    await Bun.sleep(1);

    expect(harness.sent).toEqual([JSON.stringify({ envelope_id: "env-1" })]);
    expect(inbounds).toEqual([{
      channel: "slack",
      externalId: "C123:1784738900.000100",
      conversationKey: "slack:C123",
      senderId: "U-OWNER",
      text: "hello oslo",
      origin: "owner",
      receivedAt: new Date(1_784_738_900_000.1).toISOString(),
    }]);
    expect((await channel.health()).state).toBe("ok");
    await channel.stop();
  });

  test("non-owner senders arrive as untrusted", async () => {
    const harness = socketHarness();
    const { channel, inbounds } = await listening(harness);

    harness.frame(envelope({
      type: "message",
      text: "hi",
      user: "U-STRANGER",
      channel: "C123",
      ts: "1.0",
    }));
    await Bun.sleep(1);

    expect(inbounds.map((m) => m.origin)).toEqual(["untrusted"]);
    await channel.stop();
  });

  test("filters its own posts, bot posts, and message subtypes", async () => {
    const harness = socketHarness();
    const { channel, inbounds } = await listening(harness);

    // Its own message (the notify connector posts as the same bot user).
    harness.frame(envelope({
      type: "message",
      text: "x",
      user: "U-SELF",
      channel: "C1",
      ts: "1.0",
    }));
    // Another app's post.
    harness.frame(envelope({
      type: "message",
      text: "x",
      user: "U-2",
      bot_id: "B9",
      channel: "C1",
      ts: "2.0",
    }));
    // An edit.
    harness.frame(envelope({
      type: "message",
      subtype: "message_changed",
      text: "x",
      user: "U-OWNER",
      channel: "C1",
      ts: "3.0",
    }));
    await Bun.sleep(1);

    expect(inbounds).toEqual([]);
    // Every envelope still gets acked regardless of filtering.
    expect(harness.sent).toHaveLength(3);
    await channel.stop();
  });

  test("a disconnect frame closes the socket and health degrades until reconnect", async () => {
    const harness = socketHarness();
    const { channel } = await listening(harness);

    harness.frame(
      JSON.stringify({ type: "disconnect", reason: "refresh_requested" }),
    );
    await Bun.sleep(1);

    expect((await channel.health()).state).toBe("degraded");
    await channel.stop();
    expect((await channel.health()).state).toBe("ok"); // stopped ≠ degraded
  });

  test("without an app token listen stays outbound-only", async () => {
    const channel = new SlackChannel(
      { botToken: "xoxb-x" },
      { postMessage: async () => {} },
    );
    await channel.listen(async () => {});
    expect((await channel.health()).state).toBe("ok");
  });
});
