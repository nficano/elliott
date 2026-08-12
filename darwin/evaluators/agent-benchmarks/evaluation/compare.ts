import * as Effect from "effect/Effect";
import { calculateFitness } from "../../../../src/learning/evolution/evaluation/fitness";
import { pairedBootstrapComparison } from "../../../../src/learning/evolution/evaluation/statistics";
import {
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
} from "../../../../src/learning/evolution/model/index";
import type {
  EvolutionCaseResult,
  EvolutionComparisonRequest,
} from "../../../../src/learning/evolution/model/index";
import { wireError } from "../../../runtime/wire";
import { makeFootprints, runBenchmarks } from "./benchmarks";
import { executeEvaluationCases } from "./executor";
import { holdoutSamples, totalCost, totalLatency } from "./metrics";
import { validateComparisonRequest } from "./validation";

type Fitness = ReturnType<typeof calculateFitness>;
type Comparison = Awaited<ReturnType<typeof runComparison>>;
type Benchmarks = Awaited<ReturnType<typeof runBenchmarks>>;
type Footprints = ReturnType<typeof makeFootprints>;

const runComparison = async (
  request: EvolutionComparisonRequest,
  baselineCases: readonly EvolutionCaseResult[],
  candidateCases: readonly EvolutionCaseResult[],
) => {
  const primary = request.metrics[0];
  if (primary === undefined) return wireError("primary metric is required");
  return Effect.runPromise(
    pairedBootstrapComparison({
      baseline: holdoutSamples(request, baselineCases),
      candidate: holdoutSamples(request, candidateCases),
      confidenceLevel: request.confidenceLevel,
      iterations: request.bootstrapIterations,
      seed: request.seed,
      regressionFloor: primary.regressionFloor,
      multipleComparisonCount: request.multipleComparisonCount,
    }),
  );
};

const loadCasePairs = async (request: EvolutionComparisonRequest) => {
  const baselineCases = await executeEvaluationCases(
    request,
    request.dataset.cases,
    request.baselineSnapshotId,
  );
  const candidateCases = await executeEvaluationCases(
    request,
    request.dataset.cases,
    request.candidateSnapshotId,
  );
  return { baselineCases, candidateCases };
};

const reportIdentity = (request: EvolutionComparisonRequest) => ({
  id: EvolutionEvaluationReportIdSchema.make(
    `eve_${crypto.randomUUID().replaceAll("-", "")}`,
  ),
  runId: request.run.id,
  candidateId: request.candidate.id,
  evaluatorRef: request.evaluatorRef,
  authoringRouteDigest: request.authoringRouteDigest,
  evaluationRouteDigest: request.evaluationRouteDigest,
  holdoutDigest: request.dataset.splitDigests.holdout,
  baselineSnapshotId: request.baselineSnapshotId,
  candidateSnapshotId: request.candidateSnapshotId,
  datasetDigest: request.dataset.digest,
  evaluationPlanDigest: request.evaluationPlanDigest,
  environmentDigest: request.environmentDigest,
  seed: request.seed,
});

const makeComparisonReport = (input: {
  readonly request: EvolutionComparisonRequest;
  readonly baselineCases: readonly EvolutionCaseResult[];
  readonly candidateCases: readonly EvolutionCaseResult[];
  readonly fitness: Fitness;
  readonly comparison: Comparison;
  readonly benchmarks: Benchmarks;
  readonly footprints: Footprints;
}): EvolutionEvaluationReport => {
  const allCases = [...input.baselineCases, ...input.candidateCases];
  return EvolutionEvaluationReport.make({
    ...reportIdentity(input.request),
    baselineCases: input.baselineCases,
    candidateCases: input.candidateCases,
    metrics: input.fitness.metrics,
    comparison: input.comparison,
    benchmarks: input.benchmarks,
    footprints: input.footprints,
    passed: input.fitness.passed
      && input.comparison.passed
      && input.benchmarks.every((item) => item.passed)
      && input.footprints.every((item) => item.passed),
    totalCostUsd: totalCost(allCases),
    totalLatencyMilliseconds: totalLatency(allCases),
    createdAt: new Date().toISOString(),
  });
};

export const compare = async (
  value: unknown,
): Promise<EvolutionEvaluationReport> => {
  const request = await validateComparisonRequest(value);
  const { baselineCases, candidateCases } = await loadCasePairs(request);
  const fitness = calculateFitness({
    definitions: request.metrics,
    baseline: baselineCases,
    candidate: candidateCases,
  });
  const comparison = await runComparison(
    request,
    baselineCases,
    candidateCases,
  );
  const benchmarks = await runBenchmarks(request);
  const footprints = makeFootprints({
    request,
    baselineCases,
    candidateCases,
  });
  return makeComparisonReport({
    request,
    baselineCases,
    candidateCases,
    fitness,
    comparison,
    benchmarks,
    footprints,
  });
};
