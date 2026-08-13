import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { RuntimeModelClient } from "../../../src/runtime/model/client";
import type {
  ModelTurnRequest,
  RuntimeSettings,
} from "../../../src/runtime/types";

// The client owns transport; the wire owns protocol. These assert that the
// configured wire actually reaches the network — a provider setting that
// resolved correctly but never changed the request would be worthless.

afterEach(() => {
  mock.restore();
});

const settingsFor = (wire: "anthropic" | "openai"): RuntimeSettings =>
  ({
    llmBaseUrl: wire === "anthropic"
      ? "https://api.anthropic.com/v1"
      : "https://api.openai.com/v1",
    llmWire: wire,
    llmApiKey: "sk-test",
    model: "test-model",
    maxTokens: 128,
    temperature: 0.4,
  }) as RuntimeSettings;

const turn: ModelTurnRequest = {
  system: "You are a test.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  allowTools: false,
};

const captureFetch = (payload: unknown): () => Request => {
  let captured: Request | undefined;
  spyOn(globalThis, "fetch").mockImplementation((
    input: unknown,
    init?: RequestInit,
  ) => {
    captured = new Request(String(input), init);
    return Promise.resolve(
      Response.json(payload),
    );
  });
  return () => {
    if (captured === undefined) throw new Error("fetch was never called");
    return captured;
  };
};

describe("model client wire dispatch", () => {
  it("speaks the native Anthropic protocol when the wire is anthropic", async () => {
    const request = captureFetch({
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await new RuntimeModelClient(settingsFor("anthropic"))
      .complete(turn);

    const sent = request();
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers.get("x-api-key")).toBe("sk-test");
    expect(sent.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(result.text).toBe("hello");
  });

  it("speaks the OpenAI protocol when the wire is openai", async () => {
    const request = captureFetch({
      choices: [{ message: { content: "hello" } }],
    });
    const result = await new RuntimeModelClient(settingsFor("openai"))
      .complete(turn);

    const sent = request();
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.headers.get("authorization")).toBe("Bearer sk-test");
    expect(result.text).toBe("hello");
  });

  it("attests a route digest that distinguishes the two wires", async () => {
    // The digest is the audit trail's identity for "where did this turn go".
    // Two different protocols at two different hosts must not collide.
    captureFetch({ content: [{ type: "text", text: "a" }] });
    const anthropic = await new RuntimeModelClient(settingsFor("anthropic"))
      .complete(turn);
    mock.restore();
    captureFetch({ choices: [{ message: { content: "a" } }] });
    const openai = await new RuntimeModelClient(settingsFor("openai"))
      .complete(turn);

    expect(anthropic.selection?.routeDigest).not.toBe(
      openai.selection?.routeDigest,
    );
  });

  it("reports upstream failures with the wire that produced them", async () => {
    spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("overloaded", { status: 529 }))
    );
    await expect(
      new RuntimeModelClient(settingsFor("anthropic")).complete(turn),
    ).rejects.toThrow(/Anthropic 529: overloaded/);
  });

  it("marks a malformed 2xx body as a decode failure, distinct from a transport error", async () => {
    // A reachable endpoint that returns unparseable bytes is surfaced as a
    // ModelDecodeError carrying a `decode` marker, so a caller (the doctor)
    // can classify it as reachable-but-broken rather than unreachable — and its
    // message never echoes the raw body.
    spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response("{not json sk-leak", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    );
    let thrown: unknown;
    try {
      await new RuntimeModelClient(settingsFor("anthropic")).complete(turn);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { decode?: unknown; }).decode).toBe(true);
    expect((thrown as Error).name).toBe("ModelDecodeError");
    expect((thrown as Error).message).not.toContain("sk-leak");
  });
});
