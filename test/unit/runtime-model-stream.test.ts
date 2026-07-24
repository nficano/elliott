import { describe, expect, it } from "bun:test";
import { decodeCompletionStream } from "../../src/runtime/model/stream";

const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;

describe("runtime model streaming", () => {
  it("assembles text deltas and fragmented tool calls", async () => {
    const source = [
      event({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          cost: 0.01,
        },
        choices: [],
      }),
      event({
        choices: [{
          delta: {
            content: "Let me ",
            tool_calls: [{
              index: 0,
              id: "call-1",
              function: { name: "slack_search", arguments: "{\"query\":" },
            }],
          },
        }],
      }),
      event({
        choices: [{
          delta: {
            content: "check.",
            tool_calls: [{
              index: 0,
              function: { arguments: "\"launch\"}" },
            }],
          },
        }],
      }),
      "data: [DONE]\n\n",
    ].join("");
    const response = new Response(source, {
      headers: { "content-type": "text/event-stream" },
    });
    const deltas: string[] = [];
    const result = await decodeCompletionStream(response, async (delta) => {
      deltas.push(delta);
    });
    expect(result).toEqual({
      text: "Let me check.",
      toolCalls: [{
        id: "call-1",
        name: "slack_search",
        arguments: "{\"query\":\"launch\"}",
      }],
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        costUsd: 0.01,
      },
    });
    expect(deltas).toEqual(["Let me ", "check."]);
  });
});
