import * as Schema from "effect/Schema";
import {
  EvolutionBaselineReportIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionReleaseMonitorReportIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";
import { NonNegativeFiniteSchema, NonNegativeIntSchema } from "./numeric";

export class EvolutionReleaseMonitorMetric
  extends Schema.Class<EvolutionReleaseMonitorMetric>(
    "EvolutionReleaseMonitorMetric",
  )({
    metric: Schema.Literals([
      "success-rate",
      "benchmark-score",
      "average-cost-usd",
    ]),
    direction: Schema.Literals(["maximize", "minimize"]),
    baseline: NonNegativeFiniteSchema,
    observed: NonNegativeFiniteSchema,
    maximumRegressionRatio: NonNegativeFiniteSchema,
    regressionRatio: NonNegativeFiniteSchema,
    passed: Schema.Boolean,
  })
{}

export class EvolutionReleaseMonitorReport
  extends Schema.Class<EvolutionReleaseMonitorReport>(
    "EvolutionReleaseMonitorReport",
  )({
    id: EvolutionReleaseMonitorReportIdSchema,
    releaseId: EvolutionReleaseIdSchema,
    runId: EvolutionRunIdSchema,
    targetRef: Schema.String,
    targetDigest: Schema.String,
    snapshotId: Schema.String,
    baselineReportId: EvolutionBaselineReportIdSchema,
    comparisonReportId: EvolutionEvaluationReportIdSchema,
    projectionDigest: Schema.String,
    sampleCount: NonNegativeIntSchema,
    metrics: Schema.Array(EvolutionReleaseMonitorMetric),
    status: Schema.Literals([
      "healthy",
      "regression",
      "insufficient-evidence",
    ]),
    rollbackRequired: Schema.Boolean,
    createdAt: Schema.String,
  })
{}
