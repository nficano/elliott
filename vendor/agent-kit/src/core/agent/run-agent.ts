import * as Effect from "effect/Effect";
import type { StreamTurnResult } from "../llm/types.js";
import { addUsage, type ChatMessage, ZERO_USAGE } from "../types.js";
import { assistantMessage, executeToolsEffect } from "./run-agent/tools.js";
import type {
  AgentLoopState,
  LoopOptions,
  ModelCallOptions,
} from "./run-agent/types.js";
import type {
  ModelCallInfo,
  RunAgentDeps,
  RunAgentParams,
  RunAgentResult,
} from "./types.js";

const ASSISTANT_PREVIEW_MAX_CHARS = 500;
const TOOL_PREVIEW_MAX_CHARS = 300;

/**
 * Agent loop (§7.3). Immutable-message tail recursion; `tool_choice: auto` with
 * the final round forced `none` + wrap-up; intra-round tool calls run
 * concurrently; `roundsExhausted` surfaced; mid-run steering drained at round
 * boundaries only (never mid-round), appended AFTER the complete tool-result
 * block (tool-pair invariant, §10.4). `onModelCall` is the single wrap seam
 * (§8.3); observability is its first consumer (§12).
 */
export async function runAgent(
  deps: RunAgentDeps,
  params: RunAgentParams,
): Promise<RunAgentResult> {
  return deps.obs.span(
    "gen_ai.invoke_agent",
    {
      "agentkit.agent.id": params.ctx.conversationKey,
      "gen_ai.request.model": params.model.model,
    },
    async (span) => {
      const result = await Effect.runPromise(runAgentEffect(deps, params));
      span.setAttrs(runResultAttrs(result));
      return result;
    },
  );
}

export const runAgentEffect = Effect.fn("gen_ai.invoke_agent")(function*(
  deps: RunAgentDeps,
  params: RunAgentParams,
): Effect.fn.Return<RunAgentResult, unknown> {
  yield* Effect.annotateCurrentSpan({
    "agentkit.agent.id": params.ctx.conversationKey,
    "gen_ai.request.model": params.model.model,
  });
  const state = createLoopState(params.messages);
  const schemas = [...params.tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const result = yield* runRounds({ deps, params, schemas, state });
  yield* Effect.annotateCurrentSpan(runResultAttrs(result));
  return result;
});

function createLoopState(messages: ChatMessage[]): AgentLoopState {
  return {
    messages: [...messages],
    totalUsage: ZERO_USAGE,
    toolCallCount: 0,
    finalText: "",
    isPendingToolIntent: false,
    isRoundsExhausted: false,
    round: 0,
  };
}

const runRounds = Effect.fn("agent.runRounds")(function*(
  options: LoopOptions,
): Effect.fn.Return<RunAgentResult, unknown> {
  const { params, state } = options;
  for (state.round = 0; state.round < params.maxRounds; state.round++) {
    if (yield* runRound(options)) break;
  }
  const rounds = state.round + 1;
  return {
    text: state.finalText,
    usage: state.totalUsage,
    rounds,
    roundsExhausted: state.isRoundsExhausted,
    toolCalls: state.toolCallCount,
  };
});

const runRound = Effect.fn("agent.runRound")(function*(
  options: LoopOptions,
): Effect.fn.Return<boolean, unknown> {
  const { deps, params, state } = options;
  appendSteering(state, params);
  const isWrapRound = state.round === params.maxRounds - 1;
  const result = yield* callModel({
    ...options,
    toolChoice: isWrapRound ? "none" : "auto",
  });
  state.totalUsage = addUsage(state.totalUsage, result.usage);
  params.budget.addUsage(
    result.usage,
    deps.estimateCost?.(params.model, result.usage) ?? 0,
  );
  yield* Effect.try({
    try: () => params.budget.assertWithinCap(),
    catch: (error) => error,
  });
  state.finalText = result.text;
  if (isWrapRound) {
    state.isRoundsExhausted = state.isPendingToolIntent;
    return true;
  }
  if (result.toolCalls.length === 0) return true;
  yield* appendToolResults(options, result);
  return false;
});

function appendSteering(
  state: AgentLoopState,
  params: RunAgentParams,
): void {
  const messages = params.steering.drain().map((text): ChatMessage => ({
    role: "user",
    content: `[STEERING] ${text}`,
  }));
  state.messages = [...state.messages, ...messages];
}

const appendToolResults = Effect.fn("agent.appendToolResults")(function*(
  options: LoopOptions,
  result: StreamTurnResult,
): Effect.fn.Return<void, unknown> {
  const { deps, params, state } = options;
  state.messages = [...state.messages, assistantMessage(result)];
  const toolMessages = yield* executeToolsEffect(
    deps,
    params,
    result.toolCalls,
  );
  state.toolCallCount += result.toolCalls.length;
  state.messages = [...state.messages, ...toolMessages];
  state.isPendingToolIntent = true;
  const digest = {
    round: state.round,
    assistantText: result.text.slice(0, ASSISTANT_PREVIEW_MAX_CHARS),
    tools: toolMessages.map((message, index) => ({
      name: result.toolCalls[index]?.name ?? "?",
      resultPreview: typeof message.content === "string"
        ? message.content.slice(0, TOOL_PREVIEW_MAX_CHARS)
        : "",
    })),
  };
  if (deps.observeRoundEffect) {
    yield* Effect.forkDetach(deps.observeRoundEffect(digest), {
      startImmediately: true,
    });
  } else {
    deps.observeRound?.(digest);
  }
});

const callModel = Effect.fn("agent.callModel")(function*(
  options: ModelCallOptions,
): Effect.fn.Return<StreamTurnResult, unknown> {
  const { deps, params, state, toolChoice } = options;
  const invoke = () => invokeModel(options);
  const info: ModelCallInfo = {
    round: state.round,
    model: params.model,
    toolChoice,
  };
  const hook = deps.hooks?.onModelCall?.bind(deps.hooks);
  return hook
    ? yield* Effect.tryPromise({
      try: () => hook(info, () => Effect.runPromise(invoke())),
      catch: (error) => error,
    })
    : yield* invoke();
});

const invokeModel = Effect.fn("gen_ai.chat")(function*(
  options: ModelCallOptions,
) {
  const { deps, params, schemas, state, toolChoice } = options;
  yield* Effect.annotateCurrentSpan({
    "gen_ai.request.model": params.model.model,
    "agentkit.round": state.round,
  });
  const result = yield* deps.llm.streamTurn({
    model: params.model,
    system: params.system,
    messages: state.messages,
    tools: schemas,
    toolChoice,
    cacheBreakpoint: true,
    signal: params.signal,
  });
  yield* Effect.annotateCurrentSpan({
    "gen_ai.response.model": result.responseModel,
    "gen_ai.usage.input_tokens": result.usage.input,
    "gen_ai.usage.output_tokens": result.usage.output,
    "gen_ai.usage.cached_tokens": result.usage.cacheRead,
    "gen_ai.response.finish_reasons": result.finishReason,
    "agentkit.ttft_ms": Math.round(result.ttftMs),
  });
  return result;
});

function runResultAttrs(result: RunAgentResult) {
  return {
    "gen_ai.usage.input_tokens": result.usage.input,
    "gen_ai.usage.output_tokens": result.usage.output,
    "agentkit.rounds": result.rounds,
    "agentkit.rounds_exhausted": result.roundsExhausted,
  };
}
