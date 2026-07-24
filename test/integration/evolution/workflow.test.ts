import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, MemoryCommitAdapter } from "../../../src/audit/index";
import { digest, principalId } from "../../../src/core/brands";
import { hashBytes } from "../../../src/core/digest";
import { FileSnapshotStore } from "../../../src/core/snapshot/snapshot";
import { approveProposal } from "../../../src/learning/evaluation/index";
import {
  buildEvolutionDataset,
  EvolutionBenchmarkResult,
  EvolutionBudgets,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionCaseResult,
  EvolutionConstraintResult,
  EvolutionDatasetIdSchema,
  EvolutionFootprintResult,
  EvolutionMetricDefinition,
  EvolutionTarget,
  EvolutionUnsplitDatasetCase,
  makeEvaluationHarness,
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionOrchestrator,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
  makeRequiredBenchmarkStages,
  OptimizationEngineResult,
  promoteEvolutionRelease,
} from "../../../src/learning/evolution/index";
import type {
  EvolutionPromotionActivation,
  EvolutionReleaseHooks,
} from "../../../src/learning/evolution/release/types";
import { FileProposalStore } from "../../../src/learning/proposals/index";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const cases = () =>
  Array.from({ length: 10 }, (_, index) =>
    EvolutionUnsplitDatasetCase.make({
      id: `case-${index}`,
      groupId: `group-${index}`,
      input: { task: index },
      expected: { correct: true },
      classification: "internal",
      sourceDigests: ["sha256:source"],
      timeoutMilliseconds: 1000,
      maximumCostUsd: 0,
      allowedEffects: [],
    }));

const footprints = () =>
  (["prompt", "inference", "runtime"] as const).map((category) =>
    EvolutionFootprintResult.make({
      category,
      metric: `${category}-budget`,
      baseline: 1,
      candidate: 1,
      maximumRegressionRatio: 0,
      regressionRatio: 0,
      status: "passed",
      passed: true,
    })
  );

const passingBenchmark = (
  operation: Parameters<
    ReturnType<typeof makeRequiredBenchmarkStages>[number]["run"]
  >[0],
  benchmarkRef: string,
) =>
  EvolutionBenchmarkResult.make({
    benchmarkRef,
    scope: "candidate",
    baselineScore: 1,
    candidateScore: 1,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 1,
    reportDigest: `sha256:${operation.id}:${benchmarkRef}`,
    status: "passed",
    passed: true,
  });

describe("evolution full workflow", () => {
  it("runs a fixed candidate through review, canary, and release", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-workflow-"));
    roots.push(root);
    const records = new AuditLog(new MemoryCommitAdapter());
    const runs = makeEvolutionRunStore(root);
    const candidates = makeEvolutionCandidateStore(root);
    const datasets = makeEvolutionDatasetStore(root);
    const reports = makeEvolutionEvaluationReportStore(root);
    const releases = makeEvolutionReleaseStore(root);
    const proposals = await FileProposalStore.open({
      root: path.join(root, "proposals"),
      records,
    });
    const snapshots = new FileSnapshotStore(path.join(root, "snapshots"));
    const baselineSnapshot = snapshots.create({
      configurationDigest: digest("sha256:config"),
      registryDigest: digest("sha256:registry"),
      components: [],
      configuration: { revision: "baseline" },
    });
    const candidateSnapshot = snapshots.create({
      configurationDigest: digest("sha256:candidate-config"),
      registryDigest: digest("sha256:registry"),
      components: [],
      configuration: { revision: "candidate" },
      previous: baselineSnapshot.id,
    });
    const harness = makeEvaluationHarness({
      execute: (snapshotId, evaluationCase) =>
        Effect.succeed(EvolutionCaseResult.make({
          caseId: evaluationCase.id,
          split: evaluationCase.split,
          snapshotId,
          metricValues: {
            correctness: snapshotId === candidateSnapshot.id ? 1 : 0,
          },
          costUsd: 0,
          latencyMilliseconds: 1,
          passed: true,
        })),
    });
    let optimizerCaseSplits: string[] = [];
    const engine = {
      describeCapabilities: () => Effect.die("not used"),
      optimize: (
        request: Parameters<
          import("../../../src/learning/evolution/types").OptimizationEngineShape[
            "optimize"
          ]
        >[0],
      ) => {
        optimizerCaseSplits = [
          ...request.dataset.trainCases,
          ...request.dataset.validationCases,
        ].map((item) => item.split);
        const candidate = EvolutionCandidate.make({
          id: EvolutionCandidateIdSchema.make("evc_workflow"),
          runId: request.run.id,
          targetDigest: request.run.target.baselineDigest,
          candidateDigest: hashBytes("candidate content"),
          patch: "-baseline\n+candidate",
          materializedContent: "candidate content",
          engineTraceDigest: "sha256:trace",
          usage: EvolutionCandidateUsage.make({
            inputTokens: 10,
            outputTokens: 10,
            costUsd: 0.01,
            latencyMilliseconds: 10,
          }),
          constraints: [
            EvolutionConstraintResult.make({
              constraint: "syntax",
              passed: true,
              detail: "valid",
              evidenceDigests: [],
            }),
          ],
          createdAt: new Date(1).toISOString(),
        });
        return Effect.succeed(OptimizationEngineResult.make({
          runId: request.run.id,
          candidates: [candidate],
          paused: false,
        }));
      },
      pause: () => Effect.die("not used"),
      resume: () => Effect.die("not used"),
      cancel: () => Effect.void,
    };
    const orchestrator = makeEvolutionOrchestrator({
      runs,
      candidates,
      datasets,
      reports,
      engine,
      harness,
      records,
    });
    const target = EvolutionTarget.make({
      targetClass: "skill",
      componentRef: "workspace/skill/review",
      baselineDigest: "sha256:baseline",
      riskClass: "C1",
      mutationPath: "/workspace/SKILL.md",
      allowedMutationPaths: ["/workspace/SKILL.md"],
      frozenPaths: ["/workspace/component.yaml"],
    });
    const scoped = await Effect.runPromise(orchestrator.scope({
      principalId: "EvolutionProposalAuthor",
      baselineSnapshotId: baselineSnapshot.id,
      engineRef: "organization/evaluator/dspy",
      engineKind: "gepa",
      configurationDigest: "sha256:evolution-config",
      target,
      budgets: EvolutionBudgets.make({
        maximumCandidates: 10,
        maximumTokens: 1000,
        maximumCostUsd: 10,
        maximumDurationMilliseconds: 60_000,
        maximumConcurrency: 2,
      }),
      signalIds: ["signal"],
      now: new Date(0).toISOString(),
    }));
    const dataset = await Effect.runPromise(buildEvolutionDataset({
      id: EvolutionDatasetIdSchema.make("evd_workflow"),
      targetDigest: target.baselineDigest,
      sources: [],
      cases: cases(),
      splitSeed: 1,
      split: { train: 0.6, validation: 0.2, holdout: 0.2 },
      createdAt: new Date(0).toISOString(),
    }));
    await Effect.runPromise(orchestrator.attachDataset(
      scoped.id,
      dataset,
      new Date(1).toISOString(),
    ));
    const optimized = await Effect.runPromise(orchestrator.optimize({
      runId: scoped.id,
      baselineContent: "baseline",
      seed: 1,
      now: new Date(2).toISOString(),
    }));
    const candidate = optimized[0];
    if (candidate === undefined) throw new Error("fixture candidate missing");
    const shortlisted = await Effect.runPromise(runs.get(scoped.id));
    const benchmarkStages = makeRequiredBenchmarkStages({
      targetClass: "skill",
      runner: {
        invoke: (operation) =>
          Effect.succeed(
            passingBenchmark(operation.run, operation.benchmarkRef),
          ),
      },
    });
    const report = await Effect.runPromise(orchestrator.evaluate({
      run: shortlisted,
      candidate,
      dataset,
      baselineSnapshotId: baselineSnapshot.id,
      candidateSnapshotId: candidateSnapshot.id,
      evaluatorRef: "organization/evaluator/independent",
      authoringRouteDigest: "sha256:author",
      evaluationRouteDigest: "sha256:judge",
      evaluationPlanDigest: "sha256:plan",
      environmentDigest: "sha256:environment",
      seed: 1,
      metrics: [
        EvolutionMetricDefinition.make({
          name: "correctness",
          direction: "maximize",
          weight: 1,
          regressionFloor: 0,
        }),
      ],
      confidenceLevel: 0.95,
      bootstrapIterations: 100,
      multipleComparisonCount: 1,
      requiredConstraints: ["syntax"],
      benchmarkStages,
      footprints: footprints(),
    }));
    const proposal = await Effect.runPromise(orchestrator.propose({
      runId: scoped.id,
      candidateId: candidate.id,
      reportId: report.id,
      authorId: "author",
      activeTargetDigest: target.baselineDigest,
      signals: [{
        id: "signal",
        rank: 1,
        source: "user",
        evidence: "correction",
        createdAt: new Date(0).toISOString(),
      }],
      requiredConstraints: ["syntax"],
      proposalStore: proposals,
      now: new Date(3).toISOString(),
    }));
    const approved = approveProposal(
      proposal,
      principalId("approver"),
      { proposalId: proposal.id, results: [], passed: true },
    );
    await proposals.update(approved);
    const prepared: EvolutionPromotionActivation = {
      revisionDigest: "sha256:revision",
      snapshotId: candidateSnapshot.id,
      previousRevisionDigest: "sha256:baseline-revision",
      previousSnapshotId: baselineSnapshot.id,
      touchedEpochs: ["workspace"],
      auditCrossLinkDigest: "sha256:cross-link",
    };
    const events: string[] = [];
    const hooks: EvolutionReleaseHooks = {
      recordPromotionIntent: () => Effect.sync(() => events.push("intent")),
      prepareCandidate: () => Effect.succeed(prepared),
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
          return prepared;
        }),
      recordPromoted: () => Effect.sync(() => events.push("promoted")),
      recordRollbackIntent: () => Effect.void,
      activatePriorRevision: () => Effect.die("not used"),
      recordRolledBack: () => Effect.void,
    };
    const awaitingReview = await Effect.runPromise(runs.get(scoped.id));
    const release = await Effect.runPromise(promoteEvolutionRelease(
      {
        proposal: approved,
        report,
        run: awaitingReview,
        candidate,
        promoterId: principalId("promoter"),
        promoterCapabilities: ["release.promote"],
        activeTargetDigest: target.baselineDigest,
        now: new Date(4).toISOString(),
      },
      hooks,
      { releases, runs },
    ));
    expect(release.status).toBe("active");
    expect(optimizerCaseSplits).not.toContain("holdout");
    expect((await Effect.runPromise(runs.get(scoped.id))).state._tag)
      .toBe("promoted");
    expect(events).toEqual([
      "intent",
      "canary-intent",
      "canary",
      "activate",
      "promoted",
    ]);
    expect(
      (await FileProposalStore.open({
        root: path.join(root, "proposals"),
        records,
      })).get(proposal.id)?.artifacts.benchmarksYaml,
    ).toContain("elliott-check");
    const review = proposal.artifacts.rationale;
    const permission = review.indexOf(
      "## 1. Permission and authority delta",
    );
    const digests = review.indexOf("## 2. Target and candidate digests");
    const provenance = review.indexOf(
      "## 9. Engine, route, dataset, and lineage provenance",
    );
    expect(permission).toBeGreaterThan(-1);
    expect(digests).toBeGreaterThan(permission);
    expect(provenance).toBeGreaterThan(digests);
  });
});
