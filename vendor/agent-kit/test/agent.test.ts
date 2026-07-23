import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { chunkText, escapeTelegramMarkdown } from "../src/channels/chunk.js";
import { define } from "../src/core/agent/define.js";
import { runAgent, runAgentEffect } from "../src/core/agent/run-agent.js";
import { BoundedSteering } from "../src/core/agent/steering.js";
import type {
  RunAgentDeps,
  RunAgentParams,
  ToolCtx,
  ToolDef,
} from "../src/core/agent/types.js";
import type {
  LlmPort,
  StreamTurnResult,
  TurnRequest,
} from "../src/core/llm/types.js";
import { ZERO_USAGE } from "../src/core/types.js";
import { estimateCost } from "../src/host/model/pricing.js";
import { NoopObservability } from "../src/host/observability/observability.js";
import { makeAgentDirectory } from "../src/host/runtime/agent-directory.js";
import type { AgentSpec } from "../src/host/runtime/types.js";

const ctx: ToolCtx = {
  traceId: "t",
  sessionId: "s",
  conversationKey: "telegram:1",
  origin: "owner",
};

describe("steering FIFO (§7.3)", () => {
  test("bounded cap drops oldest and counts drops", () => {
    const s = new BoundedSteering(2);
    s.push("a", "b", "c"); // drops "a"
    expect(s.drain()).toEqual(["b", "c"]);
    expect(s.dropped).toBe(1);
    expect(s.drain()).toEqual([]); // drain empties
  });
});

describe("Effect-native agent loop", () => {
  test("runs tools concurrently and appends steering after tool results", async () => {
    const requests: TurnRequest[] = [];
    const started: string[] = [];
    const barrier = Promise.withResolvers<void>();
    const steering = new BoundedSteering();
    const llm = scriptedLlm(requests, [
      turnResult("", [
        { id: "call-a", name: "tool-a", arguments: "{}" },
        { id: "call-b", name: "tool-b", arguments: "{}" },
      ]),
      turnResult("done"),
    ]);
    const tools = new Map([
      ["tool-a", concurrentTool("tool-a", started, barrier, steering)],
      ["tool-b", concurrentTool("tool-b", started, barrier, steering)],
    ]);

    const result = await Effect.runPromise(
      runAgentEffect(
        makeAgentDeps(llm),
        makeAgentParams(tools, steering),
      ),
    );

    expect(result.text).toBe("done");
    expect(result.rounds).toBe(2);
    expect(result.toolCalls).toBe(2);
    expect(started).toEqual(["tool-a", "tool-b"]);
    expect(requests[1]?.messages.slice(-4).map((message) => message.role))
      .toEqual(["assistant", "tool", "tool", "user"]);
    expect(requests[1]?.messages.at(-1)?.content)
      .toBe("[STEERING] tools finished");
  });

  test("keeps Promise hooks around model and tool calls", async () => {
    let modelHooks = 0;
    let toolHooks = 0;
    const requests: TurnRequest[] = [];
    const llm = scriptedLlm(requests, [
      turnResult("", [{ id: "call-a", name: "tool-a", arguments: "{}" }]),
      turnResult("wrapped"),
    ]);
    const hooks: NonNullable<RunAgentDeps["hooks"]> = {
      async onModelCall(_info, next) {
        modelHooks++;
        return next();
      },
      async onToolCall(_call, next) {
        toolHooks++;
        return next();
      },
    };

    const result = await runAgent(
      makeAgentDeps(llm, hooks),
      makeAgentParams(
        new Map([["tool-a", immediateTool("tool-a")]]),
        new BoundedSteering(),
      ),
    );

    expect(result.text).toBe("wrapped");
    expect(modelHooks).toBe(2);
    expect(toolHooks).toBe(1);
  });
});

describe("define() Effect Schema-first tools (§7.2)", () => {
  test("valid args run; invalid args are rejected before run", async () => {
    let ran = false;
    const tool = define({
      name: "echo",
      description: "echo the text back",
      schema: Schema.Struct({ text: Schema.String }),
      meta: { componentId: "t", bundle: "ops", core: false, write: false },
      run: async (a) => {
        ran = true;
        return a.text;
      },
    });
    const ok = await Effect.runPromise(
      tool.execute({ text: "hi" }, ctx).pipe(
        Effect.match({
          onSuccess: (v) => v,
          onFailure: (e) => `ERR:${e.message}`,
        }),
      ),
    );
    expect(ok).toBe("hi");
    expect(ran).toBe(true);

    const bad = await Effect.runPromise(
      tool.execute({ text: 42 }, ctx).pipe(
        Effect.match({
          onSuccess: (v) => v,
          onFailure: (e) => `ERR:${e.message}`,
        }),
      ),
    );
    expect(bad).toContain("ERR:");
    expect(tool.meta.cold_tokens).toBeGreaterThan(0); // schema is counted
  });
});

describe("channel delivery contract (§20)", () => {
  test("chunkText splits over the limit on clean boundaries", () => {
    const text = "para one.\n\n" + "x".repeat(50) + "\n\npara three.";
    const chunks = chunkText(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 40)).toBe(true);
  });
  test("markdown escaping escapes reserved chars", () => {
    expect(escapeTelegramMarkdown("a_b*c")).toBe(String.raw`a\_b\*c`);
  });
});

describe("pricing guard (§11)", () => {
  test("local tier is free; opus costs more than haiku", () => {
    const usage = {
      input: 1000,
      output: 500,
      cacheRead: 0,
      cacheWrite: 0,
      total: 1500,
    };
    const model = (m: string) => ({
      model: m,
      tier: "fast" as const,
      maxTokens: 1,
      temperature: 0,
      allowFallback: true,
    });
    expect(estimateCost(model("tier-local"), usage)).toBe(0);
    expect(estimateCost(model("anthropic/claude-opus-4-8"), usage))
      .toBeGreaterThan(
        estimateCost(model("anthropic/claude-haiku-4-5"), usage),
      );
  });
});

function scriptedLlm(
  requests: TurnRequest[],
  results: StreamTurnResult[],
): LlmPort {
  const next = (request: TurnRequest) =>
    Effect.sync(() => {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error("unexpected model call");
      return result;
    });
  return {
    streamTurn: next,
    complete: next,
    embed: () => Effect.die(new Error("unexpected embedding call")),
  };
}

function turnResult(
  text: string,
  toolCalls: StreamTurnResult["toolCalls"] = [],
): StreamTurnResult {
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    responseModel: "test-model",
    usage: ZERO_USAGE,
    ttftMs: 1,
    totalMs: 1,
  };
}

function concurrentTool(
  name: string,
  started: string[],
  barrier: PromiseWithResolvers<void>,
  steering: BoundedSteering,
): ToolDef {
  return {
    name,
    description: name,
    parameters: {},
    meta: { componentId: name, bundle: "test", core: false, write: false },
    execute: () =>
      Effect.promise(async () => {
        started.push(name);
        if (started.length === 2) {
          steering.push("tools finished");
          barrier.resolve();
        }
        await barrier.promise;
        return name;
      }),
  };
}

function immediateTool(name: string): ToolDef {
  return {
    name,
    description: name,
    parameters: {},
    meta: { componentId: name, bundle: "test", core: false, write: false },
    execute: () => Effect.succeed(name),
  };
}

function makeAgentDeps(
  llm: LlmPort,
  hooks?: RunAgentDeps["hooks"],
): RunAgentDeps {
  return {
    llm,
    obs: new NoopObservability(),
    ...(hooks && { hooks }),
  };
}

function makeAgentParams(
  tools: Map<string, ToolDef>,
  steering: BoundedSteering,
): RunAgentParams {
  return {
    system: "test",
    messages: [{ role: "user", content: "start" }],
    tools,
    model: {
      model: "test-model",
      tier: "fast",
      maxTokens: 100,
      temperature: 0,
      allowFallback: false,
    },
    maxRounds: 3,
    ctx: {
      ...ctx,
      steer: (text) => steering.push(text),
    },
    steering,
    budget: {
      addUsage() {},
      spentUsd: 0,
      perTurnCapUsd: 1,
      assertWithinCap() {},
    },
    signal: new AbortController().signal,
  };
}

describe("agent directory default resolution", () => {
  const spec = (id: string): AgentSpec => ({
    id,
    persona: "p",
    tier: "fast",
    maxRounds: 4,
    trust: "read",
  });

  test("a single agent is the default regardless of its name", () => {
    expect(makeAgentDirectory([spec("oslo")]).defaultAgentId).toBe("oslo");
  });

  test("an agent named \"main\" wins over singleton inference", () => {
    expect(makeAgentDirectory([spec("main")]).defaultAgentId).toBe("main");
  });

  test("multiple agents with no \"main\" keep the loud fallback", () => {
    expect(makeAgentDirectory([spec("a"), spec("b")]).defaultAgentId).toBe(
      "main",
    );
  });

  test("an explicit default always wins", () => {
    expect(makeAgentDirectory([spec("a"), spec("b")], "b").defaultAgentId)
      .toBe("b");
  });
});
