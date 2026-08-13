import { describe, expect, it } from "bun:test";
import { openaiWire } from "../../../src/runtime/model/wire/openai";
import type {
  ModelTurnRequest,
  RuntimeSettings,
} from "../../../src/runtime/types";

const settings = {
  llmBaseUrl: "https://api.openai.com/v1",
  llmApiKey: "sk-test",
  llmWire: "openai",
  model: "gpt-5",
  maxTokens: 1024,
  temperature: 0.4,
} as RuntimeSettings;

const turn: ModelTurnRequest = {
  system: "You are a test.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  allowTools: false,
};

describe("openai wire", () => {
  it("keeps temperature, which this protocol accepts", async () => {
    // The mirror of the Anthropic wire: here the configured sampling value is
    // valid and must not be silently dropped.
    const encoded = openaiWire.request(settings, turn, false);
    expect(encoded.body["temperature"]).toBeCloseTo(0.4);
  });

  it("omits reasoning_effort when effort is unconfigured", async () => {
    // Endpoints that predate the parameter reject unknown fields, so it is
    // only ever sent when the operator asked for it.
    const encoded = openaiWire.request(settings, turn, false);
    expect(encoded.body["reasoning_effort"]).toBeUndefined();
  });

  it("maps configured effort to reasoning_effort", async () => {
    const encoded = openaiWire.request(
      { ...settings, effort: "high" },
      turn,
      false,
    );
    expect(encoded.body["reasoning_effort"]).toBe("high");
  });

  it("requests usage accounting on streamed calls", async () => {
    const encoded = openaiWire.request(settings, turn, true);
    expect(encoded.body["stream"]).toBe(true);
    expect(encoded.body["stream_options"]).toEqual({ include_usage: true });
  });

  it("declares tools in the function-calling envelope", async () => {
    const encoded = openaiWire.request(settings, {
      ...turn,
      allowTools: true,
      tools: [{
        name: "lookup",
        description: "the lookup tool",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "",
      }],
    }, false);
    expect(encoded.body["tools"]).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        description: "the lookup tool",
        parameters: { type: "object", properties: {} },
      },
    }]);
    expect(encoded.body["tool_choice"]).toBe("auto");
  });

  it("carries the system prompt as the leading message", async () => {
    const encoded = openaiWire.request(settings, turn, false);
    expect(encoded.body["messages"]).toEqual([
      { role: "system", content: "You are a test." },
      { role: "user", content: "hi" },
    ]);
  });

  it("round-trips assistant tool calls and their results", async () => {
    const encoded = openaiWire.request(settings, {
      ...turn,
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "lookup", arguments: "{}" }],
        },
        { role: "tool", content: "result", toolCallId: "call_1" },
      ],
    }, false);
    const messages = encoded.body["messages"] as readonly unknown[];
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{}" },
      }],
    });
    expect(messages[2]).toEqual({
      role: "tool",
      content: "result",
      tool_call_id: "call_1",
    });
  });

  it("decodes a tool call out of a completion", async () => {
    const result = openaiWire.decode({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{\"q\":\"x\"}" },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "lookup", arguments: "{\"q\":\"x\"}" },
    ]);
    expect(result.usage?.inputTokens).toBe(10);
  });

  it("rejects a malformed tool call rather than passing it on", async () => {
    // A tool call without string arguments would reach a tool executor as
    // undefined; failing here keeps that out of the loop.
    expect(() =>
      openaiWire.decode({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_1", function: { name: "lookup" } }],
          },
        }],
      })
    ).toThrow(/invalid tool arguments/);
  });

  it("rejects a payload with no message", async () => {
    expect(() => openaiWire.decode({ choices: [] }))
      .toThrow(/returned no message/);
  });
});
