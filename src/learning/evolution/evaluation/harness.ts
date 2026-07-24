import * as Effect from "effect/Effect";
import { runBenchmarkLadder } from "../benchmarks/ladder";
import { validateCandidateConstraints } from "../constraints/engine";
import { EvolutionAuthorityError, EvolutionEvaluationError } from "../errors";
import {
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
} from "../model/index";
import { calculateFitness } from "./fitness";
import { pairedBootstrapComparison } from "./statistics";
import type {
  EvolutionCaseExecutor,
  EvolutionEvaluationPlan,
  EvolutionHarnessShape,
  EvolutionReportBuildInput,
} from "./types";

const REQUIRED_FOOTPRINT_CATEGORIES = [
  "prompt",
  "inference",
  "runtime",
] as const;

const metricSamples = (
  plan: EvolutionEvaluationPlan,
  results: Parameters<typeof calculateFitness>[0]["baseline"],
): readonly number[] => {
  const primary = plan.metrics[0];
  if (primary === undefined) return [];
  return results
    .filter((result) => result.split === "holdout")
    .map((result) => result.metricValues[primary.name])
    .filter((value): value is number => value !== undefined)
    .map((value) => primary.direction === "maximize" ? value : -value);
};

const evaluateCases = Effect.fn("evaluateEvolutionCases")(function*(
  executor: EvolutionCaseExecutor,
  plan: EvolutionEvaluationPlan,
  snapshotId: string,
) {
  const results = yield* Effect.forEach(
    plan.dataset.cases,
    (evaluationCase, index) =>
      executor.execute(snapshotId, evaluationCase, plan.seed + index),
    { concurrency: plan.run.budgets.maximumConcurrency },
  );
  const mismatched = results.find((result, index) => {
    const expected = plan.dataset.cases[index];
    return expected === undefined
      || result.snapshotId !== snapshotId
      || result.caseId !== expected.id
      || result.split !== expected.split;
  });
  if (mismatched !== undefined) {
    return yield* EvolutionEvaluationError.make({
      evaluatorRef: plan.evaluatorRef,
      operation: "snapshot-isolation",
      cause: `case ${mismatched.caseId} ran against ${mismatched.snapshotId}`,
    });
  }
  return results;
});

const runIsBound = (plan: EvolutionEvaluationPlan): boolean =>
  plan.run.state._tag === "shortlisted"
  && plan.run.state.candidateIds.includes(plan.candidate.id)
  && plan.candidate.runId === plan.run.id
  && plan.candidate.targetDigest === plan.run.target.baselineDigest;

const datasetIsBound = (plan: EvolutionEvaluationPlan): boolean =>
  plan.run.datasetId === plan.dataset.id
  && plan.run.datasetDigest === plan.dataset.digest
  && plan.dataset.targetDigest === plan.run.target.baselineDigest
  && plan.dataset.holdoutSealed;

const snapshotsAreBound = (plan: EvolutionEvaluationPlan): boolean =>
  plan.baselineSnapshotId === plan.run.baselineSnapshotId
  && plan.candidateSnapshotId !== plan.baselineSnapshotId;

const assertPlanBinding = (
  plan: EvolutionEvaluationPlan,
): Effect.Effect<void, EvolutionEvaluationError> =>
  runIsBound(plan) && datasetIsBound(plan) && snapshotsAreBound(plan)
    ? Effect.void
    : EvolutionEvaluationError.make({
      evaluatorRef: plan.evaluatorRef,
      operation: "evaluation-plan-binding",
      cause:
        "run, candidate, dataset, target, and Snapshot bindings must match",
    });

const buildReport = (input: EvolutionReportBuildInput) => {
  const {
    plan,
    baselineCases,
    candidateCases,
    fitness,
    comparison,
    benchmarks,
  } = input;
  const allCases = [...baselineCases, ...candidateCases];
  return EvolutionEvaluationReport.make({
    id: EvolutionEvaluationReportIdSchema.make(`eve_${crypto.randomUUID()}`),
    runId: plan.run.id,
    candidateId: plan.candidate.id,
    evaluatorRef: plan.evaluatorRef,
    authoringRouteDigest: plan.authoringRouteDigest,
    evaluationRouteDigest: plan.evaluationRouteDigest,
    holdoutDigest: plan.dataset.splitDigests.holdout,
    baselineSnapshotId: plan.baselineSnapshotId,
    candidateSnapshotId: plan.candidateSnapshotId,
    datasetDigest: plan.dataset.digest,
    evaluationPlanDigest: plan.evaluationPlanDigest,
    environmentDigest: plan.environmentDigest,
    seed: plan.seed,
    baselineCases,
    candidateCases,
    metrics: fitness.metrics,
    comparison,
    benchmarks,
    footprints: plan.footprints,
    passed: fitness.passed && comparison.passed
      && benchmarks.every((benchmark) => benchmark.passed)
      && plan.footprints.every((footprint) => footprint.passed),
    totalCostUsd: allCases.reduce(
      (total, result) => total + result.costUsd,
      0,
    ),
    totalLatencyMilliseconds: allCases.reduce(
      (total, result) => total + result.latencyMilliseconds,
      0,
    ),
    createdAt: new Date().toISOString(),
  });
};

const assertIndependentRoute = (plan: EvolutionEvaluationPlan) =>
  plan.authoringRouteDigest === plan.evaluationRouteDigest
    ? EvolutionAuthorityError.make({
      principalId: plan.evaluatorRef,
      action: "judge-authored-candidate",
      reason: "candidate authoring and independent evaluation routes match",
    })
    : Effect.void;

const assertFootprintCompleteness = (
  plan: EvolutionEvaluationPlan,
): Effect.Effect<void, EvolutionEvaluationError> => {
  const categories = new Set(
    plan.footprints.map((footprint) => footprint.category),
  );
  const missing = REQUIRED_FOOTPRINT_CATEGORIES.find(
    (category) => !categories.has(category),
  );
  return missing === undefined
    ? Effect.void
    : EvolutionEvaluationError.make({
      evaluatorRef: plan.evaluatorRef,
      operation: "footprint-gate",
      cause: `missing signed ${missing} footprint result`,
    });
};

const compareEvaluation = Effect.fn("compareEvolutionResults")(function*(
  plan: EvolutionEvaluationPlan,
  baselineCases: EvolutionReportBuildInput["baselineCases"],
  candidateCases: EvolutionReportBuildInput["candidateCases"],
) {
  const fitness = calculateFitness({
    definitions: plan.metrics,
    baseline: baselineCases,
    candidate: candidateCases,
  });
  const primary = plan.metrics[0];
  if (primary === undefined) {
    return yield* EvolutionEvaluationError.make({
      evaluatorRef: plan.evaluatorRef,
      operation: "compare",
      cause: "at least one metric is required",
    });
  }
  const comparison = yield* pairedBootstrapComparison({
    baseline: metricSamples(plan, baselineCases),
    candidate: metricSamples(plan, candidateCases),
    confidenceLevel: plan.confidenceLevel,
    iterations: plan.bootstrapIterations,
    seed: plan.seed,
    regressionFloor: primary.regressionFloor,
    multipleComparisonCount: plan.multipleComparisonCount,
  });
  const benchmarks = yield* runBenchmarkLadder({
    run: plan.run,
    candidate: plan.candidate,
    stages: plan.benchmarkStages,
    context: {
      baselineSnapshotId: plan.baselineSnapshotId,
      candidateSnapshotId: plan.candidateSnapshotId,
      environmentDigest: plan.environmentDigest,
      seed: plan.seed,
      timeoutMilliseconds: plan.run.budgets.maximumDurationMilliseconds,
      maximumCostUsd: plan.run.budgets.maximumCostUsd,
    },
  });
  return { fitness, comparison, benchmarks };
});

export const makeEvaluationHarness = (
  executor: EvolutionCaseExecutor,
): EvolutionHarnessShape => ({
  evaluate: Effect.fn("evaluateEvolutionCandidate")(function*(plan) {
    yield* assertPlanBinding(plan);
    yield* assertIndependentRoute(plan);
    yield* validateCandidateConstraints({
      targetRef: plan.run.target.componentRef,
      candidate: plan.candidate,
      requiredConstraints: plan.requiredConstraints,
    });
    yield* assertFootprintCompleteness(plan);
    const baselineCases = yield* evaluateCases(
      executor,
      plan,
      plan.baselineSnapshotId,
    );
    const candidateCases = yield* evaluateCases(
      executor,
      plan,
      plan.candidateSnapshotId,
    );
    const { fitness, comparison, benchmarks } = yield* compareEvaluation(
      plan,
      baselineCases,
      candidateCases,
    );
    return buildReport({
      plan,
      baselineCases,
      candidateCases,
      fitness,
      comparison,
      benchmarks,
    });
  }),
});
