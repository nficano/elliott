import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest, principalId } from "../../../src/core/brands";
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
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
  EvolutionRun,
  EvolutionStatisticalComparison,
  PromotedRunState,
} from "../../../src/learning/evolution/model/index";
import { promoteEvolutionRelease } from "../../../src/learning/evolution/release/promoter";
import { rollbackEvolutionRelease } from "../../../src/learning/evolution/release/rollback";
import type {
  EvolutionPromotionActivation,
  EvolutionReleaseHooks,
} from "../../../src/learning/evolution/release/types";
import { makeEvolutionReleaseStore } from "../../../src/learning/evolution/store/release";
import { makeEvolutionRunStore } from "../../../src/learning/evolution/store/run";
import type { Proposal } from "../../../src/learning/types";
import { makeCandidate, makeRun } from "./helpers";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true })),
  );
});

const approvedProposal = (): Proposal => ({
  id: "proposal",
  directory: "/proposal",
  author: principalId("author"),
  approver: principalId("approver"),
  target: { ref: "workspace/skill/review", digest: digest("sha256:baseline") },
  signals: [{
    id: "signal",
    rank: 1,
    source: "user",
    evidence: "correction",
    createdAt: new Date(0).toISOString(),
  }],
  artifacts: {
    rationale: "rationale",
    targetYaml: "target: review",
    patch: "patch",
    evidenceYaml: "passed: true",
    permissionDiffYaml: "widened: []",
    evaluationPlanYaml: "seed: 1",
    support: {},
  },
  status: "approved",
  evolution: {
    runId: makeRun().id,
    targetClass: "skill",
    riskClass: "C1",
    candidateDigest: makeCandidate().candidateDigest,
    baselineSnapshotId: "snapshot:baseline",
    candidateSnapshotId: "snapshot:candidate",
    evaluationReportId: "eve_12345678",
    datasetDigest: "sha256:dataset",
  },
});

const report = () => {
  const run = makeRun();
  const candidate = makeCandidate();
  const caseResult = (snapshotId: string) =>
    EvolutionCaseResult.make({
      caseId: "holdout-case",
      split: "holdout",
      snapshotId,
      metricValues: { correctness: 1 },
      costUsd: 0,
      latencyMilliseconds: 1,
      passed: true,
    });
  return EvolutionEvaluationReport.make({
    id: EvolutionEvaluationReportIdSchema.make("eve_12345678"),
    runId: run.id,
    candidateId: candidate.id,
    evaluatorRef: "organization/evaluator/independent",
    authoringRouteDigest: "sha256:author",
    evaluationRouteDigest: "sha256:judge",
    holdoutDigest: "sha256:holdout",
    baselineSnapshotId: "snapshot:baseline",
    candidateSnapshotId: "snapshot:candidate",
    datasetDigest: "sha256:dataset",
    evaluationPlanDigest: "sha256:plan",
    environmentDigest: "sha256:environment",
    seed: 1,
    baselineCases: [caseResult("snapshot:baseline")],
    candidateCases: [caseResult("snapshot:candidate")],
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
        metric: `${category}-fixture`,
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
    totalLatencyMilliseconds: 0,
    createdAt: new Date(1).toISOString(),
  });
};

const activeRelease = () => {
  const run = makeRun();
  const candidate = makeCandidate();
  return EvolutionRelease.make({
    id: EvolutionReleaseIdSchema.make("evl_12345678"),
    runId: run.id,
    proposalId: "proposal",
    candidateId: candidate.id,
    targetRef: run.target.componentRef,
    targetDigest: candidate.candidateDigest,
    revisionDigest: "sha256:revision",
    snapshotId: "snapshot:candidate",
    rollback: EvolutionRollbackMetadata.make({
      previousTargetDigest: "sha256:baseline",
      previousRevisionDigest: "sha256:baseline",
      previousSnapshotId: "snapshot:baseline",
      candidateRevisionDigest: "sha256:revision",
      candidateSnapshotId: "snapshot:candidate",
    }),
    promotedBy: "promoter",
    promotedAt: new Date(2).toISOString(),
    status: "active",
  });
};

describe("evolution release transaction", () => {
  it("SE11 records intent and canary before durable activation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-release-"));
    roots.push(root);
    const events: string[] = [];
    const activation: EvolutionPromotionActivation = {
      revisionDigest: "sha256:revision",
      snapshotId: "snapshot:candidate",
      previousRevisionDigest: "sha256:baseline",
      previousSnapshotId: "snapshot:baseline",
      touchedEpochs: ["workspace"],
      auditCrossLinkDigest: "sha256:cross-link",
    };
    const hooks: EvolutionReleaseHooks = {
      recordPromotionIntent: () => Effect.sync(() => events.push("intent")),
      prepareCandidate: () =>
        Effect.sync(() => {
          events.push("prepare");
          return activation;
        }),
      recordCanaryIntent: () => Effect.sync(() => events.push("canary-intent")),
      runCanary: () =>
        Effect.sync(() => {
          events.push("canary");
          return true;
        }),
      recordCanaryFailed: () => Effect.sync(() => events.push("canary-failed")),
      activateCandidate: () =>
        Effect.sync(() => {
          events.push("activate");
          return activation;
        }),
      recordPromoted: () => Effect.sync(() => events.push("promoted")),
      recordRollbackIntent: () => Effect.void,
      activatePriorRevision: () => Effect.succeed(activation),
      recordRolledBack: () => Effect.void,
    };
    const run = makeRun();
    const runStore = makeEvolutionRunStore(root);
    const releaseStore = makeEvolutionReleaseStore(root);
    const release = await Effect.runPromise(promoteEvolutionRelease(
      {
        proposal: approvedProposal(),
        report: report(),
        run: EvolutionRun.make({
          ...run,
          datasetId: EvolutionDatasetIdSchema.make("evd_12345678"),
          datasetDigest: "sha256:dataset",
          state: AwaitingReviewRunState.make({
            proposalId: "proposal",
          }),
        }),
        candidate: makeCandidate(),
        promoterId: principalId("promoter"),
        promoterCapabilities: ["release.promote"],
        activeTargetDigest: "sha256:baseline",
        now: new Date(2).toISOString(),
      },
      hooks,
      {
        releases: releaseStore,
        runs: runStore,
      },
    ));
    expect(release.status).toBe("active");
    const releaseHistory = await Effect.runPromise(releaseStore.list());
    expect(releaseHistory).toHaveLength(2);
    expect(releaseHistory.filter((item) => item.status === "active"))
      .toHaveLength(1);
    expect(releaseHistory.filter((item) => item.status === "canary"))
      .toHaveLength(1);
    expect(releaseHistory.find((item) => item.status === "canary")?.id)
      .toBe(release.canaryReleaseId);
    expect((await Effect.runPromise(runStore.get(run.id))).state._tag)
      .toBe("promoted");
    expect(events).toEqual([
      "intent",
      "prepare",
      "canary-intent",
      "canary",
      "activate",
      "promoted",
    ]);
  });

  it("keeps a failed canary immutable and never activates it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-canary-fail-"));
    roots.push(root);
    let activated = false;
    const activation: EvolutionPromotionActivation = {
      revisionDigest: "sha256:revision",
      snapshotId: "snapshot:candidate",
      previousRevisionDigest: "sha256:baseline",
      previousSnapshotId: "snapshot:baseline",
      touchedEpochs: ["workspace"],
      auditCrossLinkDigest: "sha256:cross-link",
    };
    const hooks: EvolutionReleaseHooks = {
      recordPromotionIntent: () => Effect.void,
      prepareCandidate: () => Effect.succeed(activation),
      recordCanaryIntent: () => Effect.void,
      runCanary: () => Effect.succeed(false),
      recordCanaryFailed: () => Effect.void,
      activateCandidate: () =>
        Effect.sync(() => {
          activated = true;
          return activation;
        }),
      recordPromoted: () => Effect.void,
      recordRollbackIntent: () => Effect.void,
      activatePriorRevision: () => Effect.die("unexpected rollback"),
      recordRolledBack: () => Effect.void,
    };
    const run = makeRun();
    const runStore = makeEvolutionRunStore(root);
    const releaseStore = makeEvolutionReleaseStore(root);
    await expect(Effect.runPromise(promoteEvolutionRelease(
      {
        proposal: approvedProposal(),
        report: report(),
        run: EvolutionRun.make({
          ...run,
          datasetId: EvolutionDatasetIdSchema.make("evd_12345678"),
          datasetDigest: "sha256:dataset",
          state: AwaitingReviewRunState.make({ proposalId: "proposal" }),
        }),
        candidate: makeCandidate(),
        promoterId: principalId("promoter"),
        promoterCapabilities: ["release.promote"],
        activeTargetDigest: "sha256:baseline",
        now: new Date(2).toISOString(),
      },
      hooks,
      { releases: releaseStore, runs: runStore },
    ))).rejects.toHaveProperty("_tag", "EvolutionPromotionError");
    expect(activated).toBe(false);
    expect((await Effect.runPromise(runStore.get(run.id))).state._tag)
      .toBe("failed");
    const history = await Effect.runPromise(releaseStore.list());
    expect(history.filter((item) => item.status === "canary")).toHaveLength(1);
    expect(history.filter((item) => item.status === "failed")).toHaveLength(1);
    await expect(Effect.runPromise(
      releaseStore.activeForTarget(run.target.componentRef),
    )).rejects.toHaveProperty("_tag", "EvolutionNotFoundError");
  });

  it("SE15 rolls back through a new immutable release and preserves history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-rollback-"));
    roots.push(root);
    const releases = makeEvolutionReleaseStore(root);
    const runs = makeEvolutionRunStore(root);
    const release = activeRelease();
    const baseRun = makeRun();
    await Effect.runPromise(releases.save(release));
    await Effect.runPromise(runs.save(EvolutionRun.make({
      ...baseRun,
      state: PromotedRunState.make({
        releaseId: release.id,
        promotedAt: release.promotedAt,
      }),
    })));
    const activation: EvolutionPromotionActivation = {
      revisionDigest: "sha256:baseline",
      snapshotId: "snapshot:rollback",
      previousRevisionDigest: release.revisionDigest,
      previousSnapshotId: release.snapshotId,
      touchedEpochs: ["workspace"],
      auditCrossLinkDigest: "sha256:rollback-link",
    };
    const hooks: EvolutionReleaseHooks = {
      recordPromotionIntent: () => Effect.void,
      prepareCandidate: () => Effect.die("unexpected preparation"),
      recordCanaryIntent: () => Effect.void,
      runCanary: () => Effect.die("unexpected canary"),
      recordCanaryFailed: () => Effect.die("unexpected canary failure"),
      activateCandidate: () => Effect.die("unexpected activation"),
      recordPromoted: () => Effect.void,
      recordRollbackIntent: () => Effect.void,
      activatePriorRevision: () => Effect.succeed(activation),
      recordRolledBack: () => Effect.void,
    };
    const rolledBack = await Effect.runPromise(rollbackEvolutionRelease(
      {
        release,
        principalId: principalId("rollback-operator"),
        now: new Date(3).toISOString(),
        capabilities: ["release.rollback"],
        activeTargetDigest: release.targetDigest,
      },
      hooks,
      { releases, runs },
    ));
    expect(rolledBack.id).not.toBe(release.id);
    expect(rolledBack.targetDigest).toBe("sha256:baseline");
    expect(rolledBack.auditCrossLinkDigest).toBe("sha256:rollback-link");
    expect((await Effect.runPromise(releases.get(release.id))).status)
      .toBe("active");
    expect((await Effect.runPromise(runs.get(baseRun.id))).state._tag)
      .toBe("rolled-back");
  });
});
