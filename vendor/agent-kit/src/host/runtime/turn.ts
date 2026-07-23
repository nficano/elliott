import * as Effect from "effect/Effect";
import { runAgentEffect } from "../../core/agent/run-agent.js";
import { BoundedSteering } from "../../core/agent/steering.js";
import {
  ConfigSvc,
  ErrorReporterSvc,
  FootprintSvc,
  LlmSvc,
  MemorySvc,
  ObsSvc,
  RegistrySvc,
  RouterSvc,
} from "../../core/di/services.js";
import type { ChatMessage } from "../../core/types.js";
import { resolveModel } from "../model/resolver.js";
import { TurnBudget } from "./budget.js";
import { RuntimeEnvSvc } from "./env.js";
import { createAgentDeps } from "./turn/agent-deps.js";
import { buildTurnCtx, toolCtxFrom } from "./turn/ctx.js";
import {
  assembleSystem,
  createObserveRound,
  createObserverState,
  loadHistory,
  persistTurn,
  recallOrigins,
} from "./turn/support.js";
import type { PreparedRun, TurnExecution, TurnSession } from "./turn/types.js";
import type {
  RuntimeServices,
  TurnCtx,
  TurnInput,
  TurnResult,
} from "./types.js";

export const runTurn = Effect.fn("runtime.runTurn")(function*(
  input: TurnInput,
): Effect.fn.Return<TurnResult, unknown, RuntimeServices> {
  const env = yield* RuntimeEnvSvc;
  const obs = yield* ObsSvc;
  const reporter = yield* ErrorReporterSvc;
  const llm = yield* LlmSvc;
  const router = yield* RouterSvc;
  const registry = yield* RegistrySvc;
  const footprint = yield* FootprintSvc;
  const memory = yield* MemorySvc;
  const config = (yield* ConfigSvc).get();
  const agent = env.agents.resolve(input.agentId)
    ?? env.agents.resolve(env.agents.defaultAgentId);
  if (!agent) {
    return yield* Effect.fail(
      new Error(`no agent '${input.agentId}' and no default`),
    );
  }
  return yield* executeTurn({
    input,
    env,
    obs,
    llm,
    router,
    registry,
    footprint,
    memory,
    config,
    agent,
  }).pipe(
    // The one turn-error seam (§12): every runTurn caller — inbound, schedule,
    // spec job — funnels failures through here before they propagate.
    Effect.tapError((error) =>
      Effect.sync(() =>
        reporter.captureException(error, {
          mechanism: "turn",
          handled: true,
          tags: {
            agent: agent.id,
            conversation: input.conversationKey,
            trace_id: obs.currentTraceId(),
          },
        })
      )
    ),
  );
});

const executeTurn = Effect.fn("gen_ai.invoke_agent")(function*(
  execution: TurnExecution,
): Effect.fn.Return<TurnResult, unknown> {
  const session = createSession(execution);
  yield* Effect.annotateCurrentSpan({
    "agentkit.component.id": session.agent.id,
    "agentkit.trust": session.agent.trust,
  });
  return yield* executeTurnSpan(session);
});

function createSession(execution: TurnExecution): TurnSession {
  const tier = execution.input.tier ?? execution.agent.tier;
  return {
    ...execution,
    abort: new AbortController(),
    budget: new TurnBudget(execution.config.budgets.per_turn_usd_max),
    steering: new BoundedSteering(),
    tier,
    model: resolveModel({
      cfg: execution.config,
      tier,
      ...(execution.agent.profile && {
        profileName: execution.agent.profile,
      }),
    }),
  };
}

const executeTurnSpan = Effect.fn("runtime.executeTurn")(function*(
  session: TurnSession,
): Effect.fn.Return<TurnResult, unknown> {
  const traceId = session.obs.currentTraceId();
  const prepared = yield* prepareRun(session, traceId);
  const result = yield* runAgentEffect(
    createAgentDeps({
      llm: session.llm,
      obs: session.obs,
      footprint: session.footprint,
      env: session.env,
      observeRoundEffect: prepared.observeRoundEffect,
    }),
    {
      system: prepared.system,
      messages: prepared.messages,
      tools: prepared.tools,
      model: session.model,
      maxRounds: session.agent.maxRounds,
      ctx: prepared.context,
      steering: session.steering,
      budget: session.budget,
      signal: session.abort.signal,
    },
  );
  prepared.observerState.isTurnActive = false;
  yield* persistTurn({
    history: session.env.history,
    memory: session.memory,
    input: session.input,
    replyText: result.text,
  });
  return {
    ...result,
    costUsd: session.budget.spentUsd,
    traceId,
  };
});

const prepareRun = Effect.fn("runtime.prepareAgentRun")(function*(
  session: TurnSession,
  traceId: string,
): Effect.fn.Return<PreparedRun, unknown> {
  const origins = recallOrigins(session.agent);
  const facts = yield* session.memory.prefetch(
    session.input.text,
    origins,
  );
  const turnContext = buildTurnCtx({
    traceId,
    conversationKey: session.input.conversationKey,
    config: session.config,
    agentId: session.agent.id,
    origin: session.input.origin,
    tier: session.tier,
    profile: {},
    budget: session.budget,
    steering: session.steering,
    signal: session.abort.signal,
  });
  const toolset = yield* prepareToolset(session, turnContext);
  const observerState = createObserverState();
  return {
    context: toolCtxFrom(turnContext),
    system: assembleSystem({
      persona: session.agent.persona,
      facts,
      fragments: session.registry.promptFragments().map((item) => item.text),
      timezone: session.config.runtime.timezone,
    }),
    messages: yield* turnMessages(session),
    tools: toolset.defs,
    observerState,
    observeRoundEffect: createObserveRound({
      observer: session.env.observer,
      memory: session.memory,
      steering: session.steering,
      state: observerState,
    }),
  };
});

const prepareToolset = Effect.fn("runtime.prepareToolset")(function*(
  session: TurnSession,
  turnContext: TurnCtx,
) {
  const bundles = session.agent.bundles
    ?? (yield* Effect.tryPromise({
      try: () => session.router.selectBundles(turnContext, session.input.text),
      catch: (error) => error,
    }));
  turnContext.bundles = bundles;
  return yield* Effect.tryPromise({
    try: () =>
      session.router.buildToolset(turnContext, bundles, {
        safe: session.input.origin === "untrusted",
      }),
    catch: (error) => error,
  });
});

const turnMessages = Effect.fn("runtime.loadTurnMessages")(function*(
  session: TurnSession,
): Effect.fn.Return<ChatMessage[]> {
  const history = session.input.history
    ?? (yield* Effect.promise(() =>
      loadHistory(
        session.env.history,
        session.input.conversationKey,
      )
    ));
  return [
    ...history,
    {
      role: "user",
      content: session.input.text,
      origin: session.input.origin,
    },
  ];
});
