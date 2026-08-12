import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { hashValue } from "../../../core/digest";
import { EvolutionPromotionError } from "../errors";
import {
  EvolutionReleaseMonitorMetric,
  EvolutionReleaseMonitorReport,
  EvolutionReleaseMonitorReportIdSchema,
} from "../model/index";
import type {
  EvolutionReleaseMonitorDependencies,
  EvolutionReleaseMonitorInput,
  EvolutionReleaseMonitorPolicy,
  EvolutionReleaseMonitorShape,
} from "./types";

const DEFAULT_POLICY: EvolutionReleaseMonitorPolicy = {
  minimumSampleCount: 1,
  maximumSuccessRegressionRatio: 0,
  maximumBenchmarkRegressionRatio: 0.02,
  maximumCostRegressionRatio: 0.2,
};
const MAXIMUM_FINITE_RATIO = Number.MAX_VALUE;

const average = (values: readonly number[], fallback: number): number =>
  values.length === 0
    ? fallback
    : values.reduce((total, value) => total + value, 0) / values.length;

const regressionRatio = (
  baseline: number,
  observed: number,
  direction: "maximize" | "minimize",
): number => {
  if (baseline === 0) {
    const regressed = direction === "maximize"
      ? observed < baseline
      : observed > baseline;
    return regressed ? MAXIMUM_FINITE_RATIO : 0;
  }
  const delta = direction === "maximize"
    ? baseline - observed
    : observed - baseline;
  return Math.max(0, delta / Math.abs(baseline));
};

const metric = (
  input: {
    readonly name: EvolutionReleaseMonitorMetric["metric"];
    readonly direction: EvolutionReleaseMonitorMetric["direction"];
    readonly baseline: number;
    readonly observed: number;
    readonly maximumRegressionRatio: number;
  },
): EvolutionReleaseMonitorMetric => {
  const regression = regressionRatio(
    input.baseline,
    input.observed,
    input.direction,
  );
  return EvolutionReleaseMonitorMetric.make({
    metric: input.name,
    direction: input.direction,
    baseline: input.baseline,
    observed: input.observed,
    maximumRegressionRatio: input.maximumRegressionRatio,
    regressionRatio: regression,
    passed: regression <= input.maximumRegressionRatio,
  });
};

const assertBindings = (
  input: EvolutionReleaseMonitorInput,
): Effect.Effect<void, EvolutionPromotionError> => {
  const bound = input.release.status === "active"
    && input.baseline.runId === input.release.runId
    && input.comparison.runId === input.release.runId
    && input.comparison.candidateId === input.release.candidateId
    && input.baseline.baselineSnapshotId
      === input.comparison.baselineSnapshotId
    && input.baseline.datasetDigest === input.comparison.datasetDigest
    && input.projection.targetRef === input.release.targetRef
    && input.projection.targetDigest === input.release.targetDigest;
  return bound
    ? Effect.void
    : EvolutionPromotionError.make({
      proposalId: input.release.proposalId,
      stage: "post-release-monitor-binding",
      reason:
        "post-release evidence is not bound to the active release lineage",
    });
};

const monitorMetrics = (
  input: EvolutionReleaseMonitorInput,
  policy: EvolutionReleaseMonitorPolicy,
): readonly EvolutionReleaseMonitorMetric[] => {
  const baselineSuccess = input.baseline.caseResults.length === 0
    ? 0
    : input.baseline.caseResults.filter((item) => item.passed).length
      / input.baseline.caseResults.length;
  const baselineBenchmark = average(
    input.comparison.benchmarks
      .filter((item) => item.status !== "not-applicable")
      .map((item) => item.baselineScore),
    baselineSuccess,
  );
  const baselineCost = input.baseline.totalCostUsd
    / Math.max(1, input.baseline.caseResults.length);
  return [
    metric({
      name: "success-rate",
      direction: "maximize",
      baseline: baselineSuccess,
      observed: input.projection.successRate,
      maximumRegressionRatio: policy.maximumSuccessRegressionRatio,
    }),
    metric({
      name: "benchmark-score",
      direction: "maximize",
      baseline: baselineBenchmark,
      observed: input.projection.benchmarkScore,
      maximumRegressionRatio: policy.maximumBenchmarkRegressionRatio,
    }),
    metric({
      name: "average-cost-usd",
      direction: "minimize",
      baseline: baselineCost,
      observed: input.projection.averageCostUsd,
      maximumRegressionRatio: policy.maximumCostRegressionRatio,
    }),
  ];
};

const monitorStatus = (
  sufficient: boolean,
  regression: boolean,
): EvolutionReleaseMonitorReport["status"] => {
  if (!sufficient) return "insufficient-evidence";
  return regression ? "regression" : "healthy";
};

const recordReport = (
  dependencies: EvolutionReleaseMonitorDependencies,
  report: EvolutionReleaseMonitorReport,
) =>
  Effect.tryPromise({
    try: async () => {
      await dependencies.records.append({
        type: "evolution.release.monitor.completed",
        scope: { level: "workspace", id: scopeId(report.targetRef) },
        durability: "observational",
        classification: "internal",
        payload: {
          reportId: report.id,
          releaseId: report.releaseId,
          targetDigest: report.targetDigest,
          snapshotId: report.snapshotId,
          baselineReportId: report.baselineReportId,
          comparisonReportId: report.comparisonReportId,
          projectionDigest: report.projectionDigest,
          status: report.status,
          rollbackRequired: report.rollbackRequired,
        },
      });
      if (report.rollbackRequired) {
        await dependencies.records.append({
          type: "evolution.release.regression-detected",
          scope: { level: "workspace", id: scopeId(report.targetRef) },
          durability: "observational",
          classification: "internal",
          payload: {
            reportId: report.id,
            releaseId: report.releaseId,
            action: "operator-rollback-required",
          },
        });
      }
    },
    catch: (cause) =>
      EvolutionPromotionError.make({
        proposalId: report.releaseId,
        stage: "record-post-release-monitor",
        reason: "failed to record the post-release monitor result",
        cause,
      }),
  });

export const makeEvolutionReleaseMonitor = (
  dependencies: EvolutionReleaseMonitorDependencies,
): EvolutionReleaseMonitorShape => ({
  monitor: Effect.fn("monitorEvolutionRelease")(function*(input) {
    yield* assertBindings(input);
    const policy = input.policy ?? DEFAULT_POLICY;
    const metrics = monitorMetrics(input, policy);
    const sufficient = input.projection.sampleCount
      >= policy.minimumSampleCount;
    const regression = sufficient && metrics.some((item) => !item.passed);
    const report = EvolutionReleaseMonitorReport.make({
      id: EvolutionReleaseMonitorReportIdSchema.make(
        `evm_${crypto.randomUUID()}`,
      ),
      releaseId: input.release.id,
      runId: input.release.runId,
      targetRef: input.release.targetRef,
      targetDigest: input.release.targetDigest,
      snapshotId: input.release.snapshotId,
      baselineReportId: input.baseline.id,
      comparisonReportId: input.comparison.id,
      projectionDigest: hashValue(input.projection),
      sampleCount: input.projection.sampleCount,
      metrics,
      status: monitorStatus(sufficient, regression),
      rollbackRequired: regression,
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
    });
    yield* dependencies.reports.save(report).pipe(
      Effect.mapError((cause) =>
        EvolutionPromotionError.make({
          proposalId: input.release.proposalId,
          stage: "persist-post-release-monitor",
          reason: "failed to persist the post-release monitor report",
          cause,
        })
      ),
    );
    yield* recordReport(dependencies, report);
    if (regression) {
      yield* Effect.promise(() =>
        dependencies.notify?.(
          `Evolution release ${report.releaseId} regressed; operator rollback is required.`,
        ).catch(() => undefined) ?? Promise.resolve()
      );
    }
    return report;
  }),
});
