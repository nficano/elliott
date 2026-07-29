import {
  EvolutionBaselineFootprint,
  EvolutionBaselineMetricResult,
  EvolutionBaselineReport,
  EvolutionBaselineReportIdSchema,
} from "../../../../src/learning/evolution/model/index";
import type { EvolutionCaseResult } from "../../../../src/learning/evolution/model/index";
import type { EvolutionBaselineRequest } from "../../../../src/learning/evolution/model/index";
import { averageMetric, totalCost, totalLatency } from "./metrics";

const BASELINE_SPLITS = ["validation", "holdout"] as const;

const baselineMetrics = (
  request: EvolutionBaselineRequest,
  results: readonly EvolutionCaseResult[],
) =>
  request.metrics.flatMap((metric) =>
    BASELINE_SPLITS.map((split) =>
      EvolutionBaselineMetricResult.make({
        metric: metric.name,
        split,
        value: averageMetric(results, metric.name, split),
        sampleCount: results.filter((item) => item.split === split).length,
      })
    )
  );

const baselineFootprints = (
  request: EvolutionBaselineRequest,
  costUsd: number,
  latencyMilliseconds: number,
) => [
  EvolutionBaselineFootprint.make({
    category: "prompt",
    metric: "target-bytes",
    value: request.targetFootprintBytes,
  }),
  EvolutionBaselineFootprint.make({
    category: "inference",
    metric: "cost-usd",
    value: costUsd,
  }),
  EvolutionBaselineFootprint.make({
    category: "runtime",
    metric: "latency-milliseconds",
    value: latencyMilliseconds,
  }),
];

export const makeBaselineReport = (
  request: EvolutionBaselineRequest,
  results: readonly EvolutionCaseResult[],
): EvolutionBaselineReport => {
  const costUsd = totalCost(results);
  const latencyMilliseconds = totalLatency(results);
  return EvolutionBaselineReport.make({
    id: EvolutionBaselineReportIdSchema.make(
      `evb_${crypto.randomUUID().replaceAll("-", "")}`,
    ),
    runId: request.run.id,
    targetDigest: request.run.target.baselineDigest,
    evaluatorRef: request.evaluatorRef,
    authoringRouteDigest: request.authoringRouteDigest,
    evaluationRouteDigest: request.evaluationRouteDigest,
    baselineSnapshotId: request.baselineSnapshotId,
    datasetDigest: request.dataset.digest,
    validationDigest: request.dataset.splitDigests.validation,
    holdoutDigest: request.dataset.splitDigests.holdout,
    evaluationPlanDigest: request.evaluationPlanDigest,
    environmentDigest: request.environmentDigest,
    seed: request.seed,
    caseResults: results,
    metrics: baselineMetrics(request, results),
    footprints: baselineFootprints(request, costUsd, latencyMilliseconds),
    trajectoryDigests: results.map((item) => item.trajectoryDigest ?? ""),
    totalCostUsd: costUsd,
    totalLatencyMilliseconds: latencyMilliseconds,
    createdAt: new Date().toISOString(),
  });
};
