import { describe, expect, it } from "bun:test";
import { RuntimeAgent } from "../../src/runtime/agent";
import type {
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeModelCompleter,
  ToolDefinition,
  TurnToolProgress,
} from "../../src/runtime/types";

// A model that issues `repeats` tool calls (arguments from `argumentsFor`),
// then finishes with plain text.
const callingModel = (
  repeats: number,
  argumentsFor: (round: number) => string,
): RuntimeModelCompleter => {
  let rounds = 0;
  return {
    complete: async (): Promise<ModelTurnResult> => {
      rounds += 1;
      return rounds <= repeats
        ? {
          text: "",
          toolCalls: [{
            id: `call-${rounds}`,
            name: "search",
            arguments: argumentsFor(rounds),
          }],
        }
        : { text: "done", toolCalls: [] };
    },
  };
};

const identicalArguments = () => JSON.stringify({ query: "same" });

const searchTool = (execute: ToolDefinition["execute"]): ToolDefinition => ({
  name: "search",
  description: "search",
  inputSchema: {},
  execute,
});

// Captures the last assembled model request; its messages include every tool
// output produced so far, in order.
const requestCapture = () => {
  const captured: { request?: ModelTurnRequest; } = {};
  return {
    captured,
    observer: {
      onModelRequest: async (request: ModelTurnRequest) => {
        captured.request = request;
      },
    },
  };
};

const toolMessages = (request: ModelTurnRequest | undefined): string[] =>
  (request?.messages ?? [])
    .filter((message) => message.role === "tool")
    .map((message) => message.content);

describe("repeated identical tool calls", () => {
  it("annotates the third identical call with a runtime notice", async () => {
    const { captured, observer } = requestCapture();
    const agent = new RuntimeAgent(
      callingModel(3, identicalArguments),
      "persona",
      [searchTool(async () => "result")],
    );
    await agent.turn("conversation", "go", { observer });
    const outputs = toolMessages(captured.request);
    expect(outputs).toHaveLength(3);
    expect(outputs[0]).toStartWith("[UNTRUSTED TOOL OUTPUT]");
    expect(outputs[1]).toStartWith("[UNTRUSTED TOOL OUTPUT]");
    expect(outputs[2]).toStartWith("[RUNTIME NOTICE] This is identical call 3");
    expect(outputs[2]).toContain("[UNTRUSTED TOOL OUTPUT]\nresult");
  });

  it("tags repeated-call progress for telemetry and evidence", async () => {
    const progress: TurnToolProgress[] = [];
    const agent = new RuntimeAgent(
      callingModel(3, identicalArguments),
      "persona",
      [searchTool(async () => "result")],
    );
    await agent.turn("conversation", "go", {
      observer: {
        onToolProgress: async (event) => {
          progress.push(event);
        },
      },
    });
    const completions = progress.filter((event) => event.status === "complete");
    expect(completions).toHaveLength(3);
    expect(completions[0]?.errorTag).toBeUndefined();
    expect(completions[1]?.errorTag).toBeUndefined();
    expect(completions[2]?.errorTag).toBe("repeated-tool-call");
  });

  it("does not warn when arguments differ between calls", async () => {
    const { captured, observer } = requestCapture();
    const agent = new RuntimeAgent(
      callingModel(3, (round) => JSON.stringify({ query: `variant-${round}` })),
      "persona",
      [searchTool(async () => "result")],
    );
    await agent.turn("conversation", "go", { observer });
    const outputs = toolMessages(captured.request);
    expect(outputs).toHaveLength(3);
    for (const content of outputs) {
      expect(content).toStartWith("[UNTRUSTED TOOL OUTPUT]");
    }
  });

  it("annotates repeated failing calls too", async () => {
    const { captured, observer } = requestCapture();
    const agent = new RuntimeAgent(
      callingModel(3, identicalArguments),
      "persona",
      [searchTool(async () => {
        throw new Error("upstream unavailable");
      })],
    );
    await agent.turn("conversation", "go", { observer });
    const outputs = toolMessages(captured.request);
    expect(outputs).toHaveLength(3);
    expect(outputs[0]).not.toContain("[RUNTIME NOTICE]");
    expect(outputs[2]).toStartWith("[RUNTIME NOTICE]");
    expect(outputs[2]).toContain("upstream unavailable");
  });

  it("resets the identical-call ledger between turns", async () => {
    // Two identical calls per turn; a persistent ledger would cross the
    // three-call threshold on the second turn.
    const model: RuntimeModelCompleter = {
      complete: async (request): Promise<ModelTurnResult> => {
        const priorCalls = request.messages.filter(
          (message) => message.role === "tool",
        ).length;
        return priorCalls < 2
          ? {
            text: "",
            toolCalls: [{
              id: `call-${priorCalls}`,
              name: "search",
              arguments: identicalArguments(),
            }],
          }
          : { text: "done", toolCalls: [] };
      },
    };
    const agent = new RuntimeAgent(model, "persona", [
      searchTool(async () => "result"),
    ]);
    const first = requestCapture();
    await agent.turn("conversation", "first", {
      observer: first.observer,
      retainHistory: false,
    });
    const second = requestCapture();
    await agent.turn("conversation", "second", {
      observer: second.observer,
      retainHistory: false,
    });
    const outputs = toolMessages(second.captured.request);
    expect(outputs).toHaveLength(2);
    for (const content of outputs) {
      expect(content).not.toContain("[RUNTIME NOTICE]");
    }
  });
});
