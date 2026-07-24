import * as Effect from "effect/Effect";
import { EvolutionEngineError, EvolutionTransitionError } from "../errors";
import {
  BudgetExhaustedRunState,
  type EvolutionCandidate,
  type EvolutionOptimizerDatasetView,
  EvolutionRun,
  OptimizationEngineRequest,
  type OptimizationEngineResult,
  OptimizingRunState,
} from "../model/index";
import { transitionEvolutionRun } from "../state";
import { appendEvolutionRecord, evolutionTransitionContext } from "./support";
import type {
  EvolutionOptimizeInput,
  EvolutionOrchestratorDependencies,
} from "./types";

export const beginOptimization = Effect.fn("beginEvolutionOptimization")(
  function*(
    run: EvolutionRun,
    input: EvolutionOptimizeInput,
    dependencies: EvolutionOrchestratorDependencies,
  ) {
    if (run.state._tag !== "dataset-ready") {
      return yield* EvolutionTransitionError.make({
        runId: run.id,
        from: run.state._tag,
        to: "optimizing",
      });
    }
    const dataset = yield* dependencies.datasets.get(run.state.datasetId);
    const transitioned = yield* transitionEvolutionRun(
      run,
      OptimizingRunState.make({
        startedAt: input.now,
        candidateCount: 0,
      }),
      evolutionTransitionContext(run, input.now),
    );
    const optimizing = EvolutionRun.make({
      ...transitioned,
      optimizationSeed: input.seed,
    });
    yield* dependencies.runs.save(optimizing);
    yield* appendEvolutionRecord(dependencies, {
      run: optimizing,
      type: "evolution.engine.started",
      payload: {
        engineRef: optimizing.engineRef,
        engineKind: optimizing.engineKind,
        datasetId: dataset.id,
      },
    });
    return { optimizing, dataset };
  },
);

const validCandidateUsage = (candidate: EvolutionCandidate): boolean =>
  Number.isSafeInteger(candidate.usage.inputTokens)
  && candidate.usage.inputTokens >= 0
  && Number.isSafeInteger(candidate.usage.outputTokens)
  && candidate.usage.outputTokens >= 0
  && Number.isFinite(candidate.usage.costUsd)
  && candidate.usage.costUsd >= 0
  && Number.isSafeInteger(candidate.usage.latencyMilliseconds)
  && candidate.usage.latencyMilliseconds >= 0;

export const assertOptimizationResult = (
  run: EvolutionRun,
  result: OptimizationEngineResult,
) => {
  const candidatesBound = result.candidates.every((candidate) =>
    candidate.runId === run.id
    && candidate.targetDigest === run.target.baselineDigest
    && validCandidateUsage(candidate)
  );
  return result.runId === run.id && candidatesBound
    ? Effect.void
    : EvolutionEngineError.make({
      engineRef: run.engineRef,
      operation: "validate-engine-result",
      cause: "engine result has invalid run, target, or resource usage binding",
    });
};

export const makeOptimizationEngineRequest = (
  run: EvolutionRun,
  dataset: EvolutionOptimizerDatasetView,
  input: EvolutionOptimizeInput,
): OptimizationEngineRequest =>
  OptimizationEngineRequest.make({
    run,
    dataset,
    baselineContent: input.baselineContent,
    maximumCandidates: run.budgets.maximumCandidates,
    maximumTokens: run.budgets.maximumTokens,
    maximumCostUsd: run.budgets.maximumCostUsd,
    maximumDurationMilliseconds: run.budgets.maximumDurationMilliseconds,
    maximumConcurrency: run.budgets.maximumConcurrency,
    seed: input.seed,
    ...(input.codeSandbox !== undefined
      && { codeSandbox: input.codeSandbox }),
  });

export const invokeOptimizationEngine = (
  request: OptimizationEngineRequest,
  dependencies: EvolutionOrchestratorDependencies,
) =>
  dependencies.engine.optimize(request).pipe(
    Effect.timeoutOrElse({
      duration: request.maximumDurationMilliseconds,
      orElse: () =>
        dependencies.engine.cancel(request.run.id).pipe(
          Effect.ignore,
          Effect.as(undefined),
        ),
    }),
  );

export const completeDurationBudget = Effect.fn(
  "completeEvolutionDurationBudget",
)(function*(
  run: EvolutionRun,
  now: string,
  dependencies: EvolutionOrchestratorDependencies,
) {
  const next = BudgetExhaustedRunState.make({
    exhaustedBudget: "maximumDurationMilliseconds",
    observed: run.budgets.maximumDurationMilliseconds,
    limit: run.budgets.maximumDurationMilliseconds,
  });
  const updated = yield* transitionEvolutionRun(
    run,
    next,
    evolutionTransitionContext(run, now),
  );
  yield* dependencies.runs.save(updated);
  yield* appendEvolutionRecord(dependencies, {
    run: updated,
    type: "evolution.budget.exhausted",
    payload: {
      budget: "maximumDurationMilliseconds",
      limit: run.budgets.maximumDurationMilliseconds,
    },
  });
  return [] as const;
});
