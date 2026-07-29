/* eslint-disable max-lines-per-function, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { hashValue } from "../../../core/digest";
import {
  makePromptInjectionStage,
  makeRequiredBenchmarkStages,
  runBenchmarkLadder,
} from "../benchmarks/index";
import { EvolutionEvaluationError } from "../errors";
import {
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionPerformanceProjection,
  EvolutionRun,
  EvolutionRunIdSchema,
  ShortlistedRunState,
} from "../model/index";
import type { EvolutionBenchmarkResult } from "../model/index";
import type { EvolutionCandidateId, EvolutionRunId } from "../types";
import type {
  RecurringEvolutionBenchmarkInput,
  RecurringEvolutionBenchmarkResult,
} from "./benchmark/types";

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

const projectionFromResults = (
  input: RecurringEvolutionBenchmarkInput,
  results: readonly EvolutionBenchmarkResult[],
  projectedAt: string,
): EvolutionPerformanceProjection => {
  const applicable = results.filter((result) =>
    result.status !== "not-applicable"
  );
  const previous = input.projections.get(input.target.componentRef);
  return EvolutionPerformanceProjection.make({
    targetRef: input.target.componentRef,
    targetClass: input.target.targetClass,
    targetDigest: input.target.baselineDigest,
    successRate: applicable.length === 0
      ? 0
      : applicable.filter((result) => result.passed).length / applicable.length,
    correctionRate: previous?.correctionRate ?? 0,
    benchmarkScore: average(
      applicable.map((result) => result.candidateScore),
    ),
    averageCostUsd: applicable.length === 0
      ? 0
      : applicable.reduce((total, result) => total + result.costUsd, 0)
        / applicable.length,
    sampleCount: applicable.length,
    projectedAt,
  });
};

const makeBaselineCandidate = (
  input: RecurringEvolutionBenchmarkInput,
  runId: EvolutionRunId,
  candidateId: EvolutionCandidateId,
  now: string,
): EvolutionCandidate =>
  EvolutionCandidate.make({
    id: candidateId,
    runId,
    targetDigest: input.target.baselineDigest,
    candidateDigest: input.target.baselineDigest,
    patch: "",
    materializedContent: input.baselineContent,
    engineTraceDigest: hashValue({
      operation: "recurring-baseline-benchmark",
      snapshotId: input.snapshotId,
      frame: input.frame,
    }),
    usage: EvolutionCandidateUsage.make({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMilliseconds: 0,
    }),
    constraints: [],
    createdAt: now,
  });

const makeBaselineRun = (
  input: RecurringEvolutionBenchmarkInput,
  runId: EvolutionRunId,
  candidateId: EvolutionCandidateId,
  now: string,
): EvolutionRun =>
  EvolutionRun.make({
    id: runId,
    principalId: input.principalId,
    baselineSnapshotId: input.snapshotId,
    engineRef: "elliott/recurring-baseline-benchmark",
    engineKind: "fixture",
    configurationDigest: hashValue({
      budgets: input.budgets,
      environmentDigest: input.environmentDigest,
      targetDigest: input.target.baselineDigest,
    }),
    signalIds: [],
    target: input.target,
    budgets: input.budgets,
    state: ShortlistedRunState.make({
      candidateIds: [candidateId],
      sealedAt: now,
    }),
    createdAt: now,
    updatedAt: now,
  });

const recordRecurringBenchmark = (
  input: RecurringEvolutionBenchmarkInput,
  results: readonly EvolutionBenchmarkResult[],
  reportDigest: string,
  passed: boolean,
) =>
  Effect.tryPromise({
    try: () =>
      input.records.append({
        type: "evolution.baseline.completed",
        scope: {
          level: "workspace",
          id: scopeId(input.target.componentRef),
        },
        durability: "observational",
        classification: "internal",
        payload: {
          targetRef: input.target.componentRef,
          targetDigest: input.target.baselineDigest,
          snapshotId: input.snapshotId,
          frameId: input.frame,
          environmentDigest: input.environmentDigest,
          reportDigest,
          passed,
          results: results.map((result) => ({
            benchmarkRef: result.benchmarkRef,
            reportDigest: result.reportDigest,
            status: result.status,
            passed: result.passed,
          })),
        },
      }),
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: "organization/evaluator/agent-benchmarks",
        operation: "record-recurring-benchmark",
        cause,
      }),
  });

export const runRecurringEvolutionBenchmark = Effect.fn(
  "runRecurringEvolutionBenchmark",
)(function*(input: RecurringEvolutionBenchmarkInput) {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const runId = EvolutionRunIdSchema.make(`evr_${crypto.randomUUID()}`);
  const candidateId = EvolutionCandidateIdSchema.make(
    `evc_${crypto.randomUUID()}`,
  );
  const candidate = makeBaselineCandidate(input, runId, candidateId, now);
  const run = makeBaselineRun(input, runId, candidateId, now);
  const results = yield* runBenchmarkLadder({
    run,
    candidate,
    // The native prompt-injection gate runs first: cheap, no companion call, and
    // it short-circuits the ladder before the expensive HTTP benchmarks if the
    // artifact carries injection/safety-bypass content.
    stages: [
      makePromptInjectionStage(input.target.targetClass),
      ...makeRequiredBenchmarkStages({
        runner: input.runner,
        targetClass: input.target.targetClass,
      }),
    ],
    context: {
      baselineSnapshotId: input.snapshotId,
      candidateSnapshotId: input.snapshotId,
      environmentDigest: input.environmentDigest,
      seed: input.seed,
      timeoutMilliseconds: input.budgets.maximumDurationMilliseconds,
      maximumCostUsd: input.budgets.maximumCostUsd,
    },
  });
  const projection = projectionFromResults(input, results, now);
  const passed = results.every((result) => result.passed);
  const reportDigest = hashValue({
    targetRef: input.target.componentRef,
    targetDigest: input.target.baselineDigest,
    snapshotId: input.snapshotId,
    environmentDigest: input.environmentDigest,
    seed: input.seed,
    results,
  });
  yield* recordRecurringBenchmark(input, results, reportDigest, passed);
  yield* Effect.try({
    try: () => input.projections.put(projection),
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: "organization/evaluator/agent-benchmarks",
        operation: "persist-recurring-benchmark-projection",
        cause,
      }),
  });
  return {
    projection,
    results,
    reportDigest,
    passed,
  } satisfies RecurringEvolutionBenchmarkResult;
});
