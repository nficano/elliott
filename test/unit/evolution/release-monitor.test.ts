import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EvolutionBaselineFootprint,
  EvolutionBaselineReport,
  EvolutionBaselineReportIdSchema,
  EvolutionBenchmarkResult,
  EvolutionCandidateIdSchema,
  EvolutionCaseResult,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionFootprintResult,
  EvolutionPerformanceProjection,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
  EvolutionRunIdSchema,
  EvolutionStatisticalComparison,
} from "../../../src/learning/evolution/model/index";
import {
  makeEvolutionReleaseMonitor,
} from "../../../src/learning/evolution/release/monitor";
import {
  makeEvolutionReleaseMonitorReportStore,
} from "../../../src/learning/evolution/store/monitor-report";

const RUN_ID = EvolutionRunIdSchema.make("evr_monitor01");
const CANDIDATE_ID = EvolutionCandidateIdSchema.make("evc_monitor01");

const baseline = EvolutionBaselineReport.make({
  id: EvolutionBaselineReportIdSchema.make("evb_monitor01"),
  runId: RUN_ID,
  targetDigest: "sha256:baseline",
  evaluatorRef: "organization/evaluator/independent",
  authoringRouteDigest: "sha256:author",
  evaluationRouteDigest: "sha256:judge",
  baselineSnapshotId: "snapshot:baseline",
  datasetDigest: "sha256:dataset",
  validationDigest: "sha256:validation",
  holdoutDigest: "sha256:holdout",
  evaluationPlanDigest: "sha256:baseline-plan",
  environmentDigest: "sha256:environment",
  seed: 1,
  caseResults: [
    EvolutionCaseResult.make({
      caseId: "case-holdout",
      split: "holdout",
      snapshotId: "snapshot:baseline",
      metricValues: { correctness: 1 },
      costUsd: 0.1,
      latencyMilliseconds: 1,
      passed: true,
      trajectoryDigest: "sha256:trajectory",
    }),
  ],
  metrics: [{
    metric: "correctness",
    split: "holdout",
    value: 1,
    sampleCount: 1,
  }],
  footprints: (["prompt", "inference", "runtime"] as const).map((category) =>
    EvolutionBaselineFootprint.make({
      category,
      metric: category,
      value: 1,
    })
  ),
  trajectoryDigests: ["sha256:trajectory"],
  totalCostUsd: 0.1,
  totalLatencyMilliseconds: 1,
  createdAt: new Date(0).toISOString(),
});

const comparison = EvolutionEvaluationReport.make({
  id: EvolutionEvaluationReportIdSchema.make("eve_monitor01"),
  runId: RUN_ID,
  candidateId: CANDIDATE_ID,
  evaluatorRef: baseline.evaluatorRef,
  authoringRouteDigest: baseline.authoringRouteDigest,
  evaluationRouteDigest: baseline.evaluationRouteDigest,
  holdoutDigest: baseline.holdoutDigest,
  baselineSnapshotId: baseline.baselineSnapshotId,
  candidateSnapshotId: "snapshot:candidate",
  datasetDigest: baseline.datasetDigest,
  evaluationPlanDigest: "sha256:comparison-plan",
  environmentDigest: baseline.environmentDigest,
  seed: baseline.seed,
  baselineCases: baseline.caseResults,
  candidateCases: [],
  metrics: [],
  comparison: EvolutionStatisticalComparison.make({
    method: "deterministic",
    effectSize: 0,
    confidenceLevel: 1,
    confidenceIntervalLow: 0,
    confidenceIntervalHigh: 0,
    sampleCount: 1,
    passed: true,
  }),
  benchmarks: [
    EvolutionBenchmarkResult.make({
      benchmarkRef: "elliott-check",
      scope: "candidate",
      baselineScore: 1,
      candidateScore: 1,
      maximumRegressionRatio: 0,
      costUsd: 0,
      latencyMilliseconds: 1,
      reportDigest: "sha256:benchmark",
      status: "passed",
      passed: true,
    }),
  ],
  footprints: (["prompt", "inference", "runtime"] as const).map((category) =>
    EvolutionFootprintResult.make({
      category,
      metric: category,
      baseline: 1,
      candidate: 1,
      maximumRegressionRatio: 0,
      regressionRatio: 0,
      status: "passed",
      passed: true,
    })
  ),
  passed: true,
  totalCostUsd: 0.1,
  totalLatencyMilliseconds: 1,
  createdAt: new Date(0).toISOString(),
});

const release = EvolutionRelease.make({
  id: EvolutionReleaseIdSchema.make("evl_monitor01"),
  runId: RUN_ID,
  proposalId: "proposal-monitor",
  candidateId: CANDIDATE_ID,
  targetRef: "workspace/skill/review",
  targetDigest: "sha256:candidate",
  revisionDigest: "sha256:revision",
  snapshotId: "snapshot:candidate",
  rollback: EvolutionRollbackMetadata.make({
    previousTargetDigest: "sha256:baseline",
    previousRevisionDigest: "sha256:previous-revision",
    previousSnapshotId: "snapshot:baseline",
    candidateRevisionDigest: "sha256:revision",
    candidateSnapshotId: "snapshot:candidate",
  }),
  promotedBy: "operator",
  promotedAt: new Date(0).toISOString(),
  status: "active",
});

describe("post-release evolution monitoring", () => {
  it("durably requires operator rollback without performing it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-monitor-"));
    const records: unknown[] = [];
    const notifications: string[] = [];
    try {
      const store = makeEvolutionReleaseMonitorReportStore(root);
      const monitor = makeEvolutionReleaseMonitor({
        reports: store,
        records: {
          append: async (draft) => {
            records.push(draft);
            return {} as never;
          },
        },
        notify: async (message) => {
          notifications.push(message);
        },
      });
      const report = await Effect.runPromise(monitor.monitor({
        release,
        baseline,
        comparison,
        projection: EvolutionPerformanceProjection.make({
          targetRef: release.targetRef,
          targetClass: "skill",
          targetDigest: release.targetDigest,
          successRate: 0.5,
          correctionRate: 0,
          benchmarkScore: 0.5,
          averageCostUsd: 0.2,
          sampleCount: 3,
          projectedAt: new Date(1).toISOString(),
        }),
        now: () => new Date(1),
      }));
      expect(report.status).toBe("regression");
      expect(report.rollbackRequired).toBeTrue();
      expect(await Effect.runPromise(store.get(report.id))).toEqual(report);
      expect(records).toHaveLength(2);
      expect(records[1]).toHaveProperty(
        "payload.action",
        "operator-rollback-required",
      );
      expect(notifications[0]).toContain("operator rollback is required");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("fails closed on projection lineage drift", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-monitor-drift-"));
    try {
      const monitor = makeEvolutionReleaseMonitor({
        reports: makeEvolutionReleaseMonitorReportStore(root),
        records: { append: async () => ({} as never) },
      });
      await expect(Effect.runPromise(monitor.monitor({
        release,
        baseline,
        comparison,
        projection: EvolutionPerformanceProjection.make({
          targetRef: release.targetRef,
          targetClass: "skill",
          targetDigest: "sha256:wrong",
          successRate: 1,
          correctionRate: 0,
          benchmarkScore: 1,
          averageCostUsd: 0,
          sampleCount: 1,
          projectedAt: new Date(1).toISOString(),
        }),
      }))).rejects.toHaveProperty("_tag", "EvolutionPromotionError");
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
