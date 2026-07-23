import * as Effect from "effect/Effect";
import type { StreamTurnResult, ToolCall } from "../../llm/types.js";
import type { ChatMessage } from "../../types.js";
import type { RunAgentDeps, RunAgentParams } from "../types.js";
import type { AllowedToolExecution, ToolExecution } from "./types.js";

export async function executeTools(
  deps: RunAgentDeps,
  params: RunAgentParams,
  calls: ToolCall[],
): Promise<ChatMessage[]> {
  return Effect.runPromise(executeToolsEffect(deps, params, calls));
}

export const executeToolsEffect = Effect.fn("agent.executeTools")(function*(
  deps: RunAgentDeps,
  params: RunAgentParams,
  calls: ToolCall[],
) {
  return yield* Effect.all(
    calls.map((call) => executeToolCall({ deps, params, call })),
    { concurrency: "unbounded" },
  );
});

const executeToolCall = Effect.fn("agent.executeToolCall")(function*(
  execution: ToolExecution,
): Effect.fn.Return<ChatMessage, unknown> {
  const { call, params } = execution;
  const definition = params.tools.get(call.name);
  const args = safeParseArgs(call.arguments);
  let content: string;
  if (definition) {
    const decision = yield* beforeToolCall(execution, args);
    content = yield* applyDecision(decision, {
      ...execution,
      definition,
      args,
    });
  } else {
    content = JSON.stringify({ error: `unknown tool: ${call.name}` });
  }
  return { role: "tool", content, tool_call_id: call.id };
});

const applyDecision = Effect.fn("agent.applyToolDecision")(function*(
  decision: "allow" | "block" | "require_approval",
  execution: AllowedToolExecution,
): Effect.fn.Return<string, unknown> {
  if (decision === "block") {
    return JSON.stringify({ error: "blocked by policy" });
  }
  if (decision === "require_approval") {
    return JSON.stringify({
      error: "approval required; staged for owner confirmation",
    });
  }
  return yield* runAllowedTool(execution);
});

const runAllowedTool = Effect.fn("gen_ai.execute_tool")(function*(
  execution: AllowedToolExecution,
): Effect.fn.Return<string, unknown> {
  const { call, definition, deps, params, args } = execution;
  yield* Effect.annotateCurrentSpan({
    "gen_ai.tool.name": call.name,
    "agentkit.component.id": definition.meta.componentId,
  });
  const started = performance.now();
  let isErrored = false;
  const execute = () =>
    definition.execute(args, params.ctx).pipe(
      Effect.match({
        onSuccess: (ok) => ok,
        onFailure: (error) => {
          isErrored = true;
          return JSON.stringify({ error: error.message });
        },
      }),
    );
  const onToolCall = deps.hooks?.onToolCall?.bind(deps.hooks);
  const output = onToolCall
    ? yield* Effect.tryPromise({
      try: () =>
        onToolCall(
          { name: call.name, args },
          () => Effect.runPromise(execute()),
        ),
      catch: (error) => error,
    })
    : yield* execute();
  deps.recordTool?.({
    componentId: definition.meta.componentId,
    toolMs: performance.now() - started,
    outputBytes: output.length,
    error: isErrored,
  });
  return output;
});

function beforeToolCall(
  execution: ToolExecution,
  args: unknown,
): Effect.Effect<"allow" | "block" | "require_approval", unknown> {
  const hook = execution.deps.hooks?.beforeToolCall?.bind(
    execution.deps.hooks,
  );
  return hook
    ? Effect.tryPromise({
      try: () => hook({ name: execution.call.name, args }),
      catch: (error) => error,
    })
    : Effect.succeed("allow");
}

export function assistantMessage(result: StreamTurnResult): ChatMessage {
  return {
    role: "assistant",
    content: [
      ...(result.text
        ? ([{ type: "text", text: result.text }] as const)
        : []),
      ...result.toolCalls.map((call) => ({
        type: "tool_use" as const,
        id: call.id,
        name: call.name,
        input: safeParseArgs(call.arguments),
      })),
    ],
  };
}

function safeParseArgs(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
