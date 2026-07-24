/* eslint-disable better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import { validateCandidateLineage } from "../candidates/lineage";
import { buildOptimizerDatasetView } from "../datasets/optimizer-view";
import { EvolutionTransitionError } from "../errors";
import {
  type EvolutionCandidate,
  type EvolutionCodeSandboxContract,
  EvolutionRun,
  OptimizingRunState,
} from "../model/index";
import {
  assertOptimizationResult,
  beginOptimization,
  completeDurationBudget,
  invokeOptimizationEngine,
  makeOptimizationEngineRequest,
} from "./engine-invocation";
import { completeOptimization } from "./optimization-completion";
import { appendEvolutionRecord } from "./support";
import type {
  EvolutionOptimizationResultInput,
  EvolutionOptimizeInput,
  EvolutionOrchestratorDependencies,
} from "./types";

const saveValidCandidates = Effect.fn("saveEvolutionCandidates")(function*(
  run: EvolutionRun,
  candidates: readonly EvolutionCandidate[],
  baselineContent: string,
  codeSandbox: EvolutionCodeSandboxContract | undefined,
  dependencies: EvolutionOrchestratorDependencies,
) {
  const valid = candidates.filter((candidate) =>
    candidate.runId === run.id
    && candidate.targetDigest === run.target.baselineDigest
  );
  const validator = dependencies.candidateValidator;
  const validated = validator === undefined
    ? valid
    : yield* Effect.forEach(
      valid,
      (candidate) =>
        validator.validate(
          run,
          candidate,
          baselineContent,
          codeSandbox,
        ),
      { concurrency: 1 },
    );
  yield* validateCandidateLineage(validated);
  yield* Effect.forEach(
    validated,
    (candidate) =>
      dependencies.candidates.save(candidate).pipe(
        Effect.tap(() =>
          appendEvolutionRecord(dependencies, {
            run,
            type: "evolution.candidate.created",
            payload: {
              candidateId: candidate.id,
              candidateDigest: candidate.candidateDigest,
              parentCandidateId: candidate.parentCandidateId ?? null,
            },
          })
        ),
      ),
    { concurrency: 1 },
  );
});

export const handleOptimizationResult = Effect.fn(
  "handleOptimizationResult",
)(function*(
  operation: EvolutionOptimizationResultInput,
  dependencies: EvolutionOrchestratorDependencies,
) {
  yield* assertOptimizationResult(operation.run, operation.result);
  yield* saveValidCandidates(
    operation.run,
    operation.result.candidates,
    operation.input.baselineContent,
    operation.input.codeSandbox,
    dependencies,
  );
  const allCandidates = yield* dependencies.candidates.listForRun(
    operation.run.id,
  );
  if (operation.result.paused) {
    const paused = EvolutionRun.make({
      ...operation.run,
      state: OptimizingRunState.make({
        startedAt: operation.run.state._tag === "optimizing"
          ? operation.run.state.startedAt
          : operation.input.now,
        candidateCount: allCandidates.length,
        ...(operation.result.resumeToken !== undefined
          && { resumeToken: operation.result.resumeToken }),
      }),
      updatedAt: operation.input.now,
    });
    yield* dependencies.runs.save(paused);
    return allCandidates;
  }
  return yield* completeOptimization(
    { input: operation.input, run: operation.run, candidates: allCandidates },
    dependencies,
  );
});

export const optimizeEvolutionRun = Effect.fn("optimizeEvolutionTarget")(
  function*(
    input: EvolutionOptimizeInput,
    dependencies: EvolutionOrchestratorDependencies,
  ) {
    const run = yield* dependencies.runs.get(input.runId);
    if (run.state._tag !== "dataset-ready") {
      return yield* EvolutionTransitionError.make({
        runId: run.id,
        from: run.state._tag,
        to: "optimizing",
      });
    }
    const { dataset, optimizing } = yield* beginOptimization(
      run,
      input,
      dependencies,
    );
    const optimizerDataset = yield* buildOptimizerDatasetView(dataset);
    const request = makeOptimizationEngineRequest(
      optimizing,
      optimizerDataset,
      input,
    );
    const result = yield* invokeOptimizationEngine(request, dependencies);
    if (result === undefined) {
      return yield* completeDurationBudget(
        optimizing,
        input.now,
        dependencies,
      );
    }
    return yield* handleOptimizationResult(
      { input, run: optimizing, result },
      dependencies,
    );
  },
);
