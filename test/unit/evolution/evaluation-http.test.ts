import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  makeRuntimeEvolutionBaselineController,
} from "../../../src/learning/evolution/evaluation/baseline";
import {
  makeEvolutionBaselinePlanDigest,
} from "../../../src/learning/evolution/evaluation/bindings";
import {
  makeFileBaselineEvaluationCache,
  makeFileEvaluationCache,
  withIndependentEvaluatorCache,
} from "../../../src/learning/evolution/evaluation/cache";
import { makeHttpIndependentEvaluator } from "../../../src/learning/evolution/evaluation/http";
import {
  DatasetReadyRunState,
  EvolutionBaselineFootprint,
  EvolutionBaselineReport,
  EvolutionBaselineReportIdSchema,
  EvolutionBaselineRequest,
  EvolutionBenchmarkResult,
  EvolutionCaseResult,
  EvolutionComparisonRequest,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionFootprintResult,
  EvolutionRun,
  EvolutionStatisticalComparison,
} from "../../../src/learning/evolution/model/index";
import {
  makeEvolutionBaselineReportStore,
} from "../../../src/learning/evolution/store/baseline-report";

const comparisonRequest = async () =>
  Schema.decodeUnknownSync(EvolutionComparisonRequest)(
    await Bun.file(
      new URL(
        "../../../companions/evaluators/agent-benchmarks/fixtures/evaluation.json",
        import.meta.url,
      ),
    ).json(),
  );

const reportFor = (
  request: EvolutionComparisonRequest,
): EvolutionEvaluationReport =>
  EvolutionEvaluationReport.make({
    id: EvolutionEvaluationReportIdSchema.make("eve_12345678"),
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
    baselineCases: request.dataset.cases.map((item) =>
      EvolutionCaseResult.make({
        caseId: item.id,
        split: item.split,
        snapshotId: request.baselineSnapshotId,
        metricValues: { correctness: 0.5 },
        costUsd: 0,
        latencyMilliseconds: 1,
        passed: true,
      })
    ),
    candidateCases: request.dataset.cases.map((item) =>
      EvolutionCaseResult.make({
        caseId: item.id,
        split: item.split,
        snapshotId: request.candidateSnapshotId,
        metricValues: { correctness: 0.8 },
        costUsd: 0,
        latencyMilliseconds: 1,
        passed: true,
      })
    ),
    metrics: [],
    comparison: EvolutionStatisticalComparison.make({
      method: "paired-bootstrap",
      effectSize: 0.3,
      confidenceLevel: 0.95,
      confidenceIntervalLow: 0.3,
      confidenceIntervalHigh: 0.3,
      sampleCount: 1,
      multipleComparisonCorrection: "none",
      passed: true,
    }),
    benchmarks: request.benchmarkGates.map((gate) =>
      EvolutionBenchmarkResult.make({
        benchmarkRef: gate.benchmarkRef,
        scope: "candidate",
        baselineScore: 1,
        candidateScore: 1,
        maximumRegressionRatio: 0,
        costUsd: 0,
        latencyMilliseconds: 0,
        reportDigest: "sha256:fixture",
        status: gate.applicable ? "passed" : "not-applicable",
        ...(!gate.applicable && {
          reason: gate.notApplicableReason ?? "not applicable",
        }),
        passed: true,
      })
    ),
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
    totalCostUsd: 0,
    totalLatencyMilliseconds: request.dataset.cases.length * 2,
    createdAt: new Date(0).toISOString(),
  });

const baselineRequest = async (): Promise<EvolutionBaselineRequest> => {
  const comparison = await comparisonRequest();
  const run = EvolutionRun.make({
    ...comparison.run,
    state: DatasetReadyRunState.make({
      datasetId: comparison.dataset.id,
      datasetDigest: comparison.dataset.digest,
    }),
  });
  const plan = {
    operation: "baseline" as const,
    run,
    dataset: comparison.dataset,
    baselineSnapshotId: comparison.baselineSnapshotId,
    evaluatorRef: comparison.evaluatorRef,
    authoringRouteDigest: comparison.authoringRouteDigest,
    evaluationRouteDigest: comparison.evaluationRouteDigest,
    environmentDigest: comparison.environmentDigest,
    seed: comparison.seed,
    targetFootprintBytes: 128,
    metrics: comparison.metrics,
  };
  return EvolutionBaselineRequest.make({
    ...plan,
    evaluationPlanDigest: makeEvolutionBaselinePlanDigest(plan),
  });
};

const baselineReportFor = (
  request: EvolutionBaselineRequest,
): EvolutionBaselineReport => {
  const cases = request.dataset.cases
    .filter((item) => item.split !== "train")
    .map((item) =>
      EvolutionCaseResult.make({
        caseId: item.id,
        split: item.split,
        snapshotId: request.baselineSnapshotId,
        metricValues: { correctness: 0.5 },
        costUsd: 0,
        latencyMilliseconds: 1,
        passed: true,
        trajectoryDigest: `sha256:trajectory-${item.id}`,
      })
    );
  return EvolutionBaselineReport.make({
    id: EvolutionBaselineReportIdSchema.make("evb_12345678"),
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
    caseResults: cases,
    metrics: request.metrics.flatMap((metric) =>
      (["validation", "holdout"] as const).map((split) => ({
        metric: metric.name,
        split,
        value: 0.5,
        sampleCount: 1,
      }))
    ),
    footprints: ([
      ["prompt", "target-bytes", request.targetFootprintBytes],
      ["inference", "cost-usd", 0],
      ["runtime", "latency-milliseconds", cases.length],
    ] as const).map(([category, metric, value]) =>
      EvolutionBaselineFootprint.make({ category, metric, value })
    ),
    trajectoryDigests: cases.map((item) => item.trajectoryDigest!),
    totalCostUsd: 0,
    totalLatencyMilliseconds: cases.length,
    createdAt: new Date(0).toISOString(),
  });
};

describe("independent evaluator HTTP boundary", () => {
  it("accepts only a baseline report bound to the pre-optimization run", async () => {
    const request = await baselineRequest();
    let requestedPath = "";
    const accepted = makeHttpIndependentEvaluator({
      endpoint: "http://127.0.0.1:9073",
      fetch: async (input) => {
        requestedPath = new URL(input.toString()).pathname;
        return Response.json(baselineReportFor(request));
      },
    });
    await expect(Effect.runPromise(accepted.baseline(request))).resolves
      .toHaveProperty("runId", request.run.id);
    expect(requestedPath).toBe("/v1/baseline");

    const rejected = makeHttpIndependentEvaluator({
      endpoint: "http://127.0.0.1:9073",
      fetch: async () =>
        Response.json(EvolutionBaselineReport.make({
          ...baselineReportFor(request),
          environmentDigest: "sha256:wrong-environment",
        })),
    });
    await expect(Effect.runPromise(rejected.baseline(request))).rejects
      .toHaveProperty("_tag", "EvolutionEvaluationError");
  });

  it("accepts only a report attesting the complete comparison request", async () => {
    const request = await comparisonRequest();
    const accepted = makeHttpIndependentEvaluator({
      endpoint: "http://127.0.0.1:9073",
      fetch: async () => Response.json(reportFor(request)),
    });
    await expect(Effect.runPromise(accepted.compare(request))).resolves
      .toHaveProperty("candidateId", request.candidate.id);

    const rejected = makeHttpIndependentEvaluator({
      endpoint: "http://127.0.0.1:9073",
      fetch: async () =>
        Response.json(EvolutionEvaluationReport.make({
          ...reportFor(request),
          environmentDigest: "sha256:wrong-environment",
        })),
    });
    await expect(Effect.runPromise(rejected.compare(request))).rejects
      .toHaveProperty("_tag", "EvolutionEvaluationError");
  });

  it("reuses only a durable digest-bound independent evaluation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-eval-cache-"));
    try {
      const request = await comparisonRequest();
      let evaluations = 0;
      const evaluator = {
        baseline: () => Effect.die("not used"),
        compare: (input: EvolutionComparisonRequest) =>
          Effect.sync(() => {
            evaluations += 1;
            return reportFor(input);
          }),
      };
      const first = withIndependentEvaluatorCache(
        evaluator,
        makeFileEvaluationCache(root),
      );
      await Effect.runPromise(first.compare(request));
      await Effect.runPromise(first.compare(request));
      const afterRestart = withIndependentEvaluatorCache(
        evaluator,
        makeFileEvaluationCache(root),
      );
      await Effect.runPromise(afterRestart.compare(request));
      expect(evaluations).toBe(1);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("reuses only a durable digest-bound baseline evaluation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-baseline-cache-"));
    try {
      const request = await baselineRequest();
      let evaluations = 0;
      const evaluator = {
        baseline: (input: EvolutionBaselineRequest) =>
          Effect.sync(() => {
            evaluations += 1;
            return baselineReportFor(input);
          }),
        compare: () => Effect.die("not used"),
      };
      const first = withIndependentEvaluatorCache(
        evaluator,
        makeFileEvaluationCache(root),
        makeFileBaselineEvaluationCache(root),
      );
      await Effect.runPromise(first.baseline(request));
      await Effect.runPromise(first.baseline(request));
      const afterRestart = withIndependentEvaluatorCache(
        evaluator,
        makeFileEvaluationCache(root),
        makeFileBaselineEvaluationCache(root),
      );
      await Effect.runPromise(afterRestart.baseline(request));
      expect(evaluations).toBe(1);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("persists and records the complete pre-optimization baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-baseline-report-"));
    try {
      const request = await baselineRequest();
      const drafts: unknown[] = [];
      const reports = makeEvolutionBaselineReportStore(root);
      const controller = makeRuntimeEvolutionBaselineController({
        evaluator: {
          baseline: (input) => Effect.succeed(baselineReportFor(input)),
          compare: () => Effect.die("not used"),
        },
        reports,
        records: {
          append: async (draft) => {
            drafts.push(draft);
            return {} as never;
          },
        },
        evaluatorRef: request.evaluatorRef,
        authoringRouteDigest: request.authoringRouteDigest,
        evaluationRouteDigest: request.evaluationRouteDigest,
        environmentDigest: request.environmentDigest,
      });
      const report = await Effect.runPromise(controller.measure({
        run: request.run,
        dataset: request.dataset,
        baselineContent: "x".repeat(request.targetFootprintBytes),
        seed: request.seed,
      }));
      expect(
        await Effect.runPromise(
          makeEvolutionBaselineReportStore(root).get(report.id),
        ),
      ).toEqual(report);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toHaveProperty(
        "payload.trajectoryDigests",
        report.trajectoryDigests,
      );
      expect(drafts[0]).toHaveProperty(
        "payload.evaluationRouteDigest",
        request.evaluationRouteDigest,
      );
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
