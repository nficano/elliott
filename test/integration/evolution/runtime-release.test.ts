import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, MemoryCommitAdapter } from "../../../src/audit/index";
import {
  componentRef,
  digest,
  principalId,
  snapshotId,
} from "../../../src/core/brands";
import { EpochRegistry } from "../../../src/core/epoch/epochs";
import { SnapshotStore } from "../../../src/core/snapshot/snapshot";
import {
  REQUIRED_PREPROMOTION_BENCHMARK_GATES,
} from "../../../src/learning/evolution/benchmarks/required";
import {
  AwaitingReviewRunState,
  EvolutionBenchmarkResult,
  EvolutionCaseResult,
  EvolutionDatasetIdSchema,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionFootprintResult,
  EvolutionMetricResult,
  EvolutionRun,
  EvolutionStatisticalComparison,
} from "../../../src/learning/evolution/model/index";
import {
  makeRuntimeEvolutionReleaseBinding,
} from "../../../src/learning/evolution/release/runtime";
import {
  makeEvolutionCandidateStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "../../../src/learning/evolution/store/index";
import { FileProposalStore } from "../../../src/learning/proposals/index";
import { makeCandidate, makeRun } from "../../unit/evolution/helpers";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true })),
  );
});

const passingReport = () => {
  const run = makeRun();
  const candidate = makeCandidate();
  const result = (id: string) =>
    EvolutionCaseResult.make({
      caseId: "holdout",
      split: "holdout",
      snapshotId: id,
      metricValues: { correctness: 1 },
      costUsd: 0,
      latencyMilliseconds: 1,
      passed: true,
    });
  return EvolutionEvaluationReport.make({
    id: EvolutionEvaluationReportIdSchema.make("eve_runtime_release"),
    runId: run.id,
    candidateId: candidate.id,
    evaluatorRef: "organization/evaluator/independent",
    authoringRouteDigest: "sha256:author",
    evaluationRouteDigest: "sha256:judge",
    holdoutDigest: "sha256:holdout",
    baselineSnapshotId: "snapshot:baseline",
    candidateSnapshotId: "snapshot:evaluated-candidate",
    datasetDigest: "sha256:dataset",
    evaluationPlanDigest: "sha256:plan",
    environmentDigest: "sha256:environment",
    seed: 1,
    baselineCases: [result("snapshot:baseline")],
    candidateCases: [result("snapshot:evaluated-candidate")],
    metrics: [
      EvolutionMetricResult.make({
        metric: "correctness",
        split: "holdout",
        baseline: 0,
        candidate: 1,
        delta: 1,
        sampleCount: 1,
        passed: true,
      }),
    ],
    comparison: EvolutionStatisticalComparison.make({
      method: "deterministic",
      effectSize: 1,
      confidenceLevel: 1,
      confidenceIntervalLow: 1,
      confidenceIntervalHigh: 1,
      sampleCount: 1,
      multipleComparisonCorrection: "none",
      passed: true,
    }),
    benchmarks: REQUIRED_PREPROMOTION_BENCHMARK_GATES.map((gate) =>
      EvolutionBenchmarkResult.make({
        benchmarkRef: gate.benchmarkRef,
        scope: "candidate",
        baselineScore: 1,
        candidateScore: 1,
        maximumRegressionRatio: 0,
        costUsd: 0,
        latencyMilliseconds: 1,
        reportDigest: `sha256:${gate.benchmarkRef}`,
        status: "passed",
        passed: true,
      })
    ),
    footprints: ["prompt", "inference", "runtime"].map((category) =>
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
    totalLatencyMilliseconds: 1,
    createdAt: new Date(1).toISOString(),
  });
};

describe("consumer runtime evolution release", () => {
  it("activates a new Snapshot and rolls back its immutable target bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-runtime-release-"));
    roots.push(root);
    const records = new AuditLog(new MemoryCommitAdapter());
    const epochs = new EpochRegistry(records);
    const snapshots = new SnapshotStore([{
      id: snapshotId("snapshot:baseline"),
      createdAt: new Date(0).toISOString(),
      configurationDigest: digest("sha256:config"),
      registryDigest: digest("sha256:registry"),
      components: [{
        ref: componentRef("workspace/skill/review"),
        manifestDigest: digest("sha256:manifest"),
        configDigest: digest("sha256:baseline"),
      }],
      configuration: {},
    }]);
    const runs = makeEvolutionRunStore(root);
    const candidates = makeEvolutionCandidateStore(root);
    const reports = makeEvolutionEvaluationReportStore(root);
    const releases = makeEvolutionReleaseStore(root);
    const proposals = await FileProposalStore.open({
      root: path.join(root, "proposals"),
      records,
    });
    const candidate = makeCandidate();
    const report = passingReport();
    const proposal = await proposals.author({
      author: principalId("author"),
      target: {
        ref: makeRun().target.componentRef,
        digest: digest("sha256:baseline"),
      },
      signals: [],
      artifacts: {
        rationale: "passing candidate",
        targetYaml: "target: review",
        patch: candidate.patch,
        evidenceYaml: "passed: true",
        permissionDiffYaml: "widened: []",
        evaluationPlanYaml: "seed: 1",
        support: {},
      },
      evolution: {
        runId: makeRun().id,
        targetClass: "skill",
        riskClass: "C1",
        candidateDigest: candidate.candidateDigest,
        baselineSnapshotId: "snapshot:baseline",
        candidateSnapshotId: report.candidateSnapshotId,
        evaluationReportId: report.id,
        datasetDigest: report.datasetDigest,
      },
    });
    await proposals.update({
      ...proposal,
      status: "approved",
      approver: principalId("approver"),
    });
    const run = EvolutionRun.make({
      ...makeRun(),
      datasetId: EvolutionDatasetIdSchema.make("evd_runtime_release"),
      datasetDigest: report.datasetDigest,
      state: AwaitingReviewRunState.make({ proposalId: proposal.id }),
    });
    await Effect.runPromise(runs.save(run));
    await Effect.runPromise(candidates.save(candidate));
    await Effect.runPromise(reports.save(report));
    let published = "snapshot:baseline";
    const binding = makeRuntimeEvolutionReleaseBinding({
      stateRoot: path.join(root, "target-revisions"),
      workspaceId: "test",
      snapshots,
      epochs,
      records,
      proposals,
      runs,
      candidates,
      reports,
      releases,
      currentSnapshotId: () => published,
      publishSnapshotId: (id) => {
        published = id;
      },
      canary: async () => true,
    });
    const promoted = await Effect.runPromise(binding.controller.promote(
      proposal.id,
      {
        principalId: "promoter",
        snapshotId: published,
        authorize: async () => true,
      },
    ));
    expect(promoted.status).toBe("active");
    expect(published).toBe(promoted.snapshotId);
    expect(binding.targets.contentForTarget(run.target.componentRef)?.content)
      .toBe(candidate.materializedContent);
    const rolledBack = await Effect.runPromise(binding.controller.rollback(
      promoted.id,
      {
        principalId: "rollback-operator",
        snapshotId: published,
        authorize: async () => true,
      },
    ));
    expect(rolledBack.targetDigest).toBe(run.target.baselineDigest);
    expect(published).toBe(rolledBack.snapshotId);
    expect(binding.targets.contentForTarget(run.target.componentRef))
      .toBeUndefined();
    expect((await Effect.runPromise(releases.list())).length).toBe(3);
  });
});
