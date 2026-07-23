import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { ImessageChannel } from "../src/channels/imessage.js";
import type { ChannelError } from "../src/core/errors.js";

// A fetch stub the channel is constructed with — no globalThis patching.
function stub(httpStatus: number, json: unknown) {
  const calls: Array<{ url: string; body: Record<string, unknown>; }> = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return Response.json(json, { status: httpStatus });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function runFail(
  eff: Effect.Effect<unknown, ChannelError>,
): Promise<ChannelError> {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) {
    throw new Error("expected failure, got success");
  }
  return result.failure;
}

describe("ImessageChannel (ported api-h12o bluebubbles connector)", () => {
  test("turns a handle into a chat GUID and posts to BlueBubbles", async () => {
    const { calls, fetchImpl } = stub(200, {
      status: 200,
      data: { guid: "g1" },
    });
    const channel = new ImessageChannel({ password: "pw" }, fetchImpl);

    await Effect.runPromise(
      channel.send({ conversationKey: "imessage:+15551234567", text: "yo" }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      // BlueBubbles is LAN HTTP; the channel must not upgrade the scheme.
      // eslint-disable-next-line unicorn/prefer-https
      "http://host.docker.internal:1234/api/v1/message/text?password=pw",
    );
    expect(calls[0]!.body.chatGuid).toBe("iMessage;-;+15551234567");
    expect(calls[0]!.body.message).toBe("yo");
    expect(calls[0]!.body.method).toBe("apple-script");
    expect(typeof calls[0]!.body.tempGuid).toBe("string");
  });

  test("passes a full chat GUID through unchanged; honors SMS + custom server", async () => {
    const { calls, fetchImpl } = stub(200, { status: 200 });
    const channel = new ImessageChannel(
      { password: "pw", service: "SMS", serverUrl: "http://spruce:1234" },
      fetchImpl,
    );

    await Effect.runPromise(
      channel.send({
        conversationKey: "imessage:iMessage;-;chat123",
        text: "hi",
      }),
    );
    expect(calls[0]!.url.startsWith("http://spruce:1234/")).toBe(true);
    expect(calls[0]!.body.chatGuid).toBe("iMessage;-;chat123");
  });

  test("body status >= 400 (HTTP 200) surfaces as a delivery failure", async () => {
    const { fetchImpl } = stub(200, { status: 500, message: "boom" });
    const channel = new ImessageChannel({ password: "pw" }, fetchImpl);

    const error = await runFail(
      channel.send({ conversationKey: "imessage:+1", text: "x" }),
    );
    expect(error.kind).toBe("delivery");
    expect(error.message).toContain("boom");
  });

  test("missing recipient with no default is a delivery failure", async () => {
    const { fetchImpl } = stub(200, { status: 200 });
    const channel = new ImessageChannel({ password: "pw" }, fetchImpl);

    const error = await runFail(
      channel.send({ conversationKey: "imessage:", text: "x" }),
    );
    expect(error.kind).toBe("delivery");
    expect(error.message).toContain("no recipient");
  });
});
