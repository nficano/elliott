import { describe, expect, it } from "bun:test";
import { anthropicWire } from "../../../src/runtime/model/wire/anthropic";
import type {
  ModelTurnRequest,
  RuntimeSettings,
} from "../../../src/runtime/types";

// The native Anthropic wire: POST /messages with x-api-key, content-block
// bodies, and the message/tool_use/tool_result shape. This is deliberately
// NOT the OpenAI-compatible endpoint — that one cannot express thinking or
// effort, which is the whole reason for a second wire.

const settings = {
  llmBaseUrl: "https://api.anthropic.com/v1",
  llmApiKey: "sk-ant-test",
  llmWire: "anthropic",
  model: "claude-opus-5",
  maxTokens: 1024,
  temperature: 0.4,
} as RuntimeSettings;

const turn = (
  overrides: Partial<ModelTurnRequest> = {},
): ModelTurnRequest => ({
  system: "You are a test.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  allowTools: false,
  ...overrides,
});

const tool = (name: string) => ({
  name,
  description: `the ${name} tool`,
  inputSchema: { type: "object", properties: {} },
  execute: async () => "",
});

const encoder = new TextEncoder();

const sseResponse = (events: readonly unknown[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

describe("anthropic wire — request encoding", () => {
  it("posts to /messages with x-api-key and a pinned api version", async () => {
    const encoded = anthropicWire.request(settings, turn(), false);
    expect(encoded.url).toBe("https://api.anthropic.com/v1/messages");
    expect(encoded.headers["x-api-key"]).toBe("sk-ant-test");
    expect(encoded.headers["anthropic-version"]).toBe("2023-06-01");
    // Bearer is the OpenAI-compat scheme; the native endpoint wants x-api-key.
    expect(encoded.headers["authorization"]).toBeUndefined();
  });

  it("omits temperature, which current Anthropic models reject outright", async () => {
    // temperature/top_p/top_k were removed on Opus 4.7+ and return a 400.
    // Sending the configured value would break every current model.
    const encoded = anthropicWire.request(settings, turn(), false);
    expect(encoded.body["temperature"]).toBeUndefined();
    expect(encoded.body["max_tokens"]).toBe(1024);
    expect(encoded.body["model"]).toBe("claude-opus-5");
  });

  it("lifts the system prompt to the top-level system field", async () => {
    const encoded = anthropicWire.request(settings, turn(), false);
    expect(encoded.body["system"]).toBe("You are a test.");
    expect(encoded.body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("maps assistant tool calls to tool_use blocks with parsed input", async () => {
    const encoded = anthropicWire.request(
      settings,
      turn({
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{
              id: "t1",
              name: "lookup",
              arguments: "{\"q\":\"x\"}",
            }],
          },
        ],
      }),
      false,
    );
    expect(encoded.body["messages"]).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "lookup", input: { q: "x" } },
        ],
      },
    ]);
  });

  it("merges consecutive tool results into one user message", async () => {
    // Anthropic requires every tool_result for a parallel batch in a single
    // user turn; emitting one message per result is a 400.
    const encoded = anthropicWire.request(
      settings,
      turn({
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "t1", name: "a", arguments: "{}" },
              { id: "t2", name: "b", arguments: "{}" },
            ],
          },
          { role: "tool", content: "ra", toolCallId: "t1" },
          { role: "tool", content: "rb", toolCallId: "t2" },
        ],
      }),
      false,
    );
    const messages = encoded.body["messages"] as readonly unknown[];
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "ra" },
        { type: "tool_result", tool_use_id: "t2", content: "rb" },
      ],
    });
  });

  it("omits tools and tool_choice entirely when no tools are offered", async () => {
    const encoded = anthropicWire.request(settings, turn(), false);
    expect(encoded.body["tools"]).toBeUndefined();
    expect(encoded.body["tool_choice"]).toBeUndefined();
  });

  it("declares tools and forbids their use when allowTools is false", async () => {
    const encoded = anthropicWire.request(
      settings,
      turn({ tools: [tool("lookup")], allowTools: false }),
      false,
    );
    expect(encoded.body["tools"]).toEqual([
      {
        name: "lookup",
        description: "the lookup tool",
        input_schema: { type: "object", properties: {} },
      },
    ]);
    expect(encoded.body["tool_choice"]).toEqual({ type: "none" });
  });

  it("lets the model choose when tools are allowed", async () => {
    const encoded = anthropicWire.request(
      settings,
      turn({ tools: [tool("lookup")], allowTools: true }),
      false,
    );
    expect(encoded.body["tool_choice"]).toEqual({ type: "auto" });
  });

  it("sets stream only when streaming", async () => {
    expect(anthropicWire.request(settings, turn(), false).body["stream"])
      .toBeUndefined();
    expect(anthropicWire.request(settings, turn(), true).body["stream"])
      .toBe(true);
  });
});

describe("anthropic wire — thinking and effort", () => {
  it("sends neither thinking nor effort when unconfigured", async () => {
    // Omitting both leaves the model's own defaults in force, which is the
    // only choice that stays correct as those defaults change per model.
    const encoded = anthropicWire.request(settings, turn(), false);
    expect(encoded.body["thinking"]).toBeUndefined();
    expect(encoded.body["output_config"]).toBeUndefined();
  });

  it("passes configured thinking through as a native thinking block", async () => {
    const encoded = anthropicWire.request(
      { ...settings, thinking: "adaptive" },
      turn(),
      false,
    );
    expect(encoded.body["thinking"]).toEqual({ type: "adaptive" });
  });

  it("passes configured effort through inside output_config", async () => {
    const encoded = anthropicWire.request(
      { ...settings, effort: "xhigh" },
      turn(),
      false,
    );
    expect(encoded.body["output_config"]).toEqual({ effort: "xhigh" });
  });
});

describe("anthropic wire — response decoding", () => {
  it("joins text blocks and leaves thinking out of the answer", async () => {
    const result = anthropicWire.decode({
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    });
    expect(result.text).toBe("Hello world");
    expect(result.text).not.toContain("internal");
  });

  it("decodes tool_use blocks into tool calls with serialized arguments", async () => {
    const result = anthropicWire.decode({
      content: [
        { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
      ],
    });
    expect(result.toolCalls).toEqual([
      { id: "toolu_1", name: "lookup", arguments: "{\"q\":\"x\"}" },
    ]);
  });

  it("decodes native token counts into elliott's usage shape", async () => {
    const result = anthropicWire.decode({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 12, output_tokens: 5 },
    });
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      costUsd: 0,
    });
  });
});

describe("anthropic wire — streaming", () => {
  it("emits text deltas and returns the joined text", async () => {
    const seen: string[] = [];
    const result = await anthropicWire.decodeStream(
      sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 3 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "lo" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
      async (delta) => {
        seen.push(delta);
      },
    );
    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.text).toBe("Hello");
  });

  it("assembles a streamed tool call from its start block and json deltas", async () => {
    const result = await anthropicWire.decodeStream(
      sseResponse([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_9", name: "lookup" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{\"q\":" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "\"x\"}" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
      async () => {},
    );
    expect(result.toolCalls).toEqual([
      { id: "toolu_9", name: "lookup", arguments: "{\"q\":\"x\"}" },
    ]);
  });

  it("does not stream thinking deltas as answer text", async () => {
    const seen: string[] = [];
    const result = await anthropicWire.decodeStream(
      sseResponse([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
      async (delta) => {
        seen.push(delta);
      },
    );
    expect(seen).toEqual([]);
    expect(result.text).toBe("");
  });

  it("collects usage across message_start and message_delta", async () => {
    const result = await anthropicWire.decodeStream(
      sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 30 } } },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 7 },
        },
        { type: "message_stop" },
      ]),
      async () => {},
    );
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 7,
      costUsd: 0,
    });
  });

  it("surfaces a mid-stream error event as a thrown error", async () => {
    await expect(
      anthropicWire.decodeStream(
        sseResponse([
          {
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          },
        ]),
        async () => {},
      ),
    ).rejects.toThrow(/overloaded_error/);
  });
});
