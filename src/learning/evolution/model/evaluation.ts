import * as Schema from "effect/Schema";
import { EvolutionCandidate } from "./candidate";
import { EvolutionDatasetCase, EvolutionDatasetManifest } from "./dataset";
import {
  EvolutionBenchmarkScopeSchema,
  EvolutionCandidateIdSchema,
  EvolutionDatasetSplitSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionMetricDirectionSchema,
  EvolutionRunIdSchema,
} from "./identifiers";
import {
  NonNegativeFiniteSchema,
  PositiveFiniteSchema,
  PositiveIntSchema,
} from "./numeric";
import { EvolutionRun } from "./run";

export class EvolutionMetricDefinition
  extends Schema.Class<EvolutionMetricDefinition>(
    "EvolutionMetricDefinition",
  )({
    name: Schema.String,
    direction: EvolutionMetricDirectionSchema,
    weight: Schema.Number,
    regressionFloor: Schema.Number,
  })
{}

export class EvolutionMetricResult
  extends Schema.Class<EvolutionMetricResult>("EvolutionMetricResult")({
    metric: Schema.String,
    split: EvolutionDatasetSplitSchema,
    baseline: Schema.Number,
    candidate: Schema.Number,
    delta: Schema.Number,
    sampleCount: Schema.Int,
    passed: Schema.Boolean,
  })
{}

export class EvolutionCaseResult
  extends Schema.Class<EvolutionCaseResult>("EvolutionCaseResult")({
    caseId: Schema.String,
    split: EvolutionDatasetSplitSchema,
    snapshotId: Schema.String,
    metricValues: Schema.Record(Schema.String, Schema.Number),
    costUsd: Schema.Number,
    latencyMilliseconds: Schema.Int,
    passed: Schema.Boolean,
    errorTag: Schema.optionalKey(Schema.String),
    trajectoryDigest: Schema.optionalKey(Schema.String),
  })
{}

export class EvolutionStatisticalComparison
  extends Schema.Class<EvolutionStatisticalComparison>(
    "EvolutionStatisticalComparison",
  )({
    method: Schema.Literals([
      "paired-bootstrap",
      "paired-permutation",
      "deterministic",
    ]),
    effectSize: Schema.Number,
    confidenceLevel: Schema.Number,
    confidenceIntervalLow: Schema.Number,
    confidenceIntervalHigh: Schema.Number,
    pValue: Schema.optionalKey(Schema.Number),
    sampleCount: Schema.Int,
    multipleComparisonCorrection: Schema.optionalKey(Schema.String),
    passed: Schema.Boolean,
  })
{}

export class EvolutionBenchmarkResult
  extends Schema.Class<EvolutionBenchmarkResult>("EvolutionBenchmarkResult")({
    benchmarkRef: Schema.String,
    scope: EvolutionBenchmarkScopeSchema,
    baselineScore: Schema.Number,
    candidateScore: Schema.Number,
    maximumRegressionRatio: Schema.Number,
    costUsd: Schema.Number,
    latencyMilliseconds: Schema.Int,
    reportDigest: Schema.String,
    status: Schema.Literals([
      "passed",
      "failed",
      "not-applicable",
      "skipped",
    ]),
    reason: Schema.optionalKey(Schema.String),
    passed: Schema.Boolean,
  })
{}

export class EvolutionFootprintResult
  extends Schema.Class<EvolutionFootprintResult>("EvolutionFootprintResult")({
    category: Schema.Literals(["prompt", "inference", "runtime"]),
    metric: Schema.String,
    baseline: Schema.Number,
    candidate: Schema.Number,
    maximumRegressionRatio: Schema.Number,
    regressionRatio: Schema.Number,
    status: Schema.Literals(["passed", "failed", "not-applicable"]),
    reason: Schema.optionalKey(Schema.String),
    passed: Schema.Boolean,
  })
{}

export class EvolutionEvaluationReport
  extends Schema.Class<EvolutionEvaluationReport>(
    "EvolutionEvaluationReport",
  )({
    id: EvolutionEvaluationReportIdSchema,
    runId: EvolutionRunIdSchema,
    candidateId: EvolutionCandidateIdSchema,
    evaluatorRef: Schema.String,
    authoringRouteDigest: Schema.String,
    evaluationRouteDigest: Schema.String,
    holdoutDigest: Schema.String,
    baselineSnapshotId: Schema.String,
    candidateSnapshotId: Schema.String,
    datasetDigest: Schema.String,
    evaluationPlanDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
    baselineCases: Schema.Array(EvolutionCaseResult),
    candidateCases: Schema.Array(EvolutionCaseResult),
    metrics: Schema.Array(EvolutionMetricResult),
    comparison: EvolutionStatisticalComparison,
    benchmarks: Schema.Array(EvolutionBenchmarkResult),
    footprints: Schema.Array(EvolutionFootprintResult),
    passed: Schema.Boolean,
    totalCostUsd: Schema.Number,
    totalLatencyMilliseconds: Schema.Int,
    createdAt: Schema.String,
  })
{}

export class EvolutionEvaluationBenchmarkGate
  extends Schema.Class<EvolutionEvaluationBenchmarkGate>(
    "EvolutionEvaluationBenchmarkGate",
  )({
    benchmarkRef: Schema.String,
    operation: Schema.Literals(["runSubset", "runFull", "compareBaseline"]),
    applicable: Schema.Boolean,
    notApplicableReason: Schema.optionalKey(Schema.String),
  })
{}

export class EvolutionFootprintLimit
  extends Schema.Class<EvolutionFootprintLimit>("EvolutionFootprintLimit")({
    category: Schema.Literals(["prompt", "inference", "runtime"]),
    metric: Schema.String,
    baseline: NonNegativeFiniteSchema,
    maximumRegressionRatio: NonNegativeFiniteSchema,
  })
{}

export class EvolutionComparisonRequest
  extends Schema.Class<EvolutionComparisonRequest>(
    "EvolutionComparisonRequest",
  )({
    operation: Schema.Literal("compare"),
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    dataset: EvolutionDatasetManifest,
    baselineSnapshotId: Schema.String,
    candidateSnapshotId: Schema.String,
    evaluatorRef: Schema.String,
    authoringRouteDigest: Schema.String,
    evaluationRouteDigest: Schema.String,
    evaluationPlanDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
    metrics: Schema.Array(EvolutionMetricDefinition),
    confidenceLevel: Schema.Number.check(
      Schema.makeFilter((value) =>
        value > 0 && value < 1
          ? undefined
          : "confidenceLevel must be between zero and one"
      ),
    ),
    bootstrapIterations: PositiveIntSchema,
    multipleComparisonCount: PositiveIntSchema,
    requiredConstraints: Schema.Array(Schema.String),
    benchmarkGates: Schema.Array(EvolutionEvaluationBenchmarkGate),
    footprintLimits: Schema.Array(EvolutionFootprintLimit),
  })
{}

export class EvolutionEvaluateCaseOperation
  extends Schema.Class<EvolutionEvaluateCaseOperation>(
    "EvolutionEvaluateCaseOperation",
  )({
    operation: Schema.Literal("evaluateCase"),
    snapshotId: Schema.String,
    evaluationCase: EvolutionDatasetCase,
    evaluatorRef: Schema.String,
    evaluationRouteDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
  })
{}

export class EvolutionEvaluateDatasetOperation
  extends Schema.Class<EvolutionEvaluateDatasetOperation>(
    "EvolutionEvaluateDatasetOperation",
  )({
    operation: Schema.Literal("evaluateDataset"),
    snapshotId: Schema.String,
    dataset: EvolutionDatasetManifest,
    evaluatorRef: Schema.String,
    evaluationRouteDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
  })
{}

export const EvolutionEvaluationOperation = Schema.Union([
  EvolutionEvaluateCaseOperation,
  EvolutionEvaluateDatasetOperation,
  EvolutionComparisonRequest,
]);

export class EvolutionBenchmarkOperation
  extends Schema.Class<EvolutionBenchmarkOperation>(
    "EvolutionBenchmarkOperation",
  )({
    operation: Schema.Literals(["runSubset", "runFull", "compareBaseline"]),
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    benchmarkRef: Schema.String,
    baselineSnapshotId: Schema.String,
    candidateSnapshotId: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
    timeoutMilliseconds: PositiveIntSchema,
    maximumCostUsd: PositiveFiniteSchema,
  })
{}
