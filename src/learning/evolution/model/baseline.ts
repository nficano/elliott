import * as Schema from "effect/Schema";
import { EvolutionDatasetManifest } from "./dataset";
import { EvolutionCaseResult, EvolutionMetricDefinition } from "./evaluation";
import {
  EvolutionBaselineReportIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";
import { NonNegativeFiniteSchema } from "./numeric";
import { EvolutionRun } from "./run";

export class EvolutionBaselineMetricResult
  extends Schema.Class<EvolutionBaselineMetricResult>(
    "EvolutionBaselineMetricResult",
  )({
    metric: Schema.String,
    split: Schema.Literals(["validation", "holdout"]),
    value: Schema.Number,
    sampleCount: Schema.Int,
  })
{}

export class EvolutionBaselineFootprint
  extends Schema.Class<EvolutionBaselineFootprint>(
    "EvolutionBaselineFootprint",
  )({
    category: Schema.Literals(["prompt", "inference", "runtime"]),
    metric: Schema.String,
    value: NonNegativeFiniteSchema,
  })
{}

export class EvolutionBaselineRequest
  extends Schema.Class<EvolutionBaselineRequest>(
    "EvolutionBaselineRequest",
  )({
    operation: Schema.Literal("baseline"),
    run: EvolutionRun,
    dataset: EvolutionDatasetManifest,
    baselineSnapshotId: Schema.String,
    evaluatorRef: Schema.String,
    authoringRouteDigest: Schema.String,
    evaluationRouteDigest: Schema.String,
    evaluationPlanDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
    targetFootprintBytes: NonNegativeFiniteSchema,
    metrics: Schema.Array(EvolutionMetricDefinition),
  })
{}

export class EvolutionBaselineReport
  extends Schema.Class<EvolutionBaselineReport>(
    "EvolutionBaselineReport",
  )({
    id: EvolutionBaselineReportIdSchema,
    runId: EvolutionRunIdSchema,
    targetDigest: Schema.String,
    evaluatorRef: Schema.String,
    authoringRouteDigest: Schema.String,
    evaluationRouteDigest: Schema.String,
    baselineSnapshotId: Schema.String,
    datasetDigest: Schema.String,
    validationDigest: Schema.String,
    holdoutDigest: Schema.String,
    evaluationPlanDigest: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
    caseResults: Schema.Array(EvolutionCaseResult),
    metrics: Schema.Array(EvolutionBaselineMetricResult),
    footprints: Schema.Array(EvolutionBaselineFootprint),
    trajectoryDigests: Schema.Array(Schema.String),
    totalCostUsd: NonNegativeFiniteSchema,
    totalLatencyMilliseconds: Schema.Int,
    createdAt: Schema.String,
  })
{}
