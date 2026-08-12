import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  digest as brandedDigest,
  principalId,
  snapshotId,
} from "../../../src/core/brands";
import { hashBytes } from "../../../src/core/digest";
import type { Snapshot } from "../../../src/core/snapshot/types";
import {
  auditEvolutionProductionAcceptance,
  buildEvolutionDataset,
  decodeEvolutionProductionAcceptanceManifest,
  EvolutionAcceptanceArtifactError,
  type EvolutionAcceptanceArtifactReader,
  type EvolutionAcceptanceLineageArtifacts,
  EvolutionBenchmarkResult,
  EvolutionBudgets,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionCaseResult,
  EvolutionCiAcceptanceEvidence,
  EvolutionCodeCampaignEvidence,
  EvolutionCompanionDeploymentEvidence,
  EvolutionConstraintResult,
  EvolutionDarwinianLegalEvidence,
  EvolutionDatasetIdSchema,
  EvolutionDatasetSource,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionExecutorDeploymentEvidence,
  EvolutionFootprintResult,
  EvolutionMetricResult,
  EvolutionProductionAcceptanceManifest,
  evolutionProductionLineageDigest,
  EvolutionProductionReleaseEvidence,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
  EvolutionRouteSeparationEvidence,
  EvolutionRun,
  EvolutionRunIdSchema,
  EvolutionSchedulerAcceptanceEvidence,
  EvolutionStatisticalComparison,
  EvolutionTarget,
  EvolutionUnsplitDatasetCase,
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
  makeFileEvolutionAcceptanceReader,
  REQUIRED_PREPROMOTION_BENCHMARK_GATES,
  RolledBackRunState,
} from "../../../src/learning/evolution/index";
import { proposalMetadata } from "../../../src/learning/proposals/codec";
import type { Proposal, ProposalArtifacts } from "../../../src/learning/types";

const roots: string[] = [];
const AUTHOR_ROUTE = `sha256:${"e".repeat(64)}`;
const JUDGE_ROUTE = `sha256:${"f".repeat(64)}`;

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const sha = (value: string): string => `sha256:${value.repeat(64)}`;

const fixtureNames = {
  skill: "skill0001",
  "tool-description": "tool00001",
  "prompt-segment": "prompt001",
  code: "code00001",
} as const;

const snapshot = (
  id: string,
  configuration: Readonly<Record<string, unknown>>,
  previous?: string,
): Snapshot =>
  Object.freeze({
    id: snapshotId(id),
    createdAt: new Date(0).toISOString(),
    configurationDigest: brandedDigest(sha("4")),
    registryDigest: brandedDigest(sha("5")),
    components: Object.freeze([]),
    configuration,
    ...(previous !== undefined && { previous: snapshotId(previous) }),
  });

const proposalArtifacts = (): ProposalArtifacts => ({
  rationale: "# Production review\n",
  targetYaml: "target: production\n",
  patch: "-old\n+new\n",
  evidenceYaml: "passed: true\n",
  permissionDiffYaml: "widened: []\n",
  evaluationPlanYaml: "seed: 17\n",
  candidateYaml: "candidate: retained\n",
  lineageYaml: "lineage: retained\n",
  datasetYaml: "dataset: retained\n",
  comparisonYaml: "comparison: passed\n",
  footprintsYaml: "footprints: passed\n",
  benchmarksYaml: "benchmarks: passed\n",
  rollbackYaml: "rollback: retained\n",
  support: { "case-summary.jsonl": "{\"passed\":true}\n" },
});

const datasetCases = () =>
  Array.from({ length: 20 }, (_, index) =>
    EvolutionUnsplitDatasetCase.make({
      id: `case-${index}`,
      groupId: `group-${index}`,
      input: { task: index },
      expected: { correct: true },
      classification: "internal",
      sourceDigests: [sha("6")],
      timeoutMilliseconds: 1000,
      maximumCostUsd: 1,
      allowedEffects: [],
    }));

const passingBenchmarks = (
  targetClass: keyof typeof fixtureNames,
) =>
  REQUIRED_PREPROMOTION_BENCHMARK_GATES
    .filter((gate) => gate.targetClasses.includes(targetClass))
    .map((gate) =>
      EvolutionBenchmarkResult.make({
        benchmarkRef: gate.benchmarkRef,
        scope: "candidate",
        baselineScore: 1,
        candidateScore: 1,
        maximumRegressionRatio: 0,
        costUsd: 0,
        latencyMilliseconds: 1,
        reportDigest: sha("7"),
        status: "passed",
        passed: true,
      })
    );

const makeLineage = async (
  targetClass: keyof typeof fixtureNames,
): Promise<{
  readonly evidence: EvolutionProductionReleaseEvidence;
  readonly artifacts: EvolutionAcceptanceLineageArtifacts;
}> => {
  const name = fixtureNames[targetClass];
  const riskClass = targetClass === "code" ? "C2" : "C1";
  const runId = EvolutionRunIdSchema.make(`evr_${name}`);
  const candidateId = EvolutionCandidateIdSchema.make(`evc_${name}`);
  const datasetId = EvolutionDatasetIdSchema.make(`evd_${name}`);
  const reportId = EvolutionEvaluationReportIdSchema.make(`eve_${name}`);
  const releaseId = EvolutionReleaseIdSchema.make(`evl_${name}`);
  const canaryReleaseId = EvolutionReleaseIdSchema.make(`evl_canary_${name}`);
  const rollbackReleaseId = EvolutionReleaseIdSchema.make(
    `evl_rollback_${name}`,
  );
  const targetRef = `workspace/${targetClass}/${name}`;
  const baselineDigest = sha("8");
  const candidateContent = `candidate-${targetClass}`;
  const candidateDigest = hashBytes(candidateContent);
  const baselineSnapshotId = `snapshot:${name}:baseline`;
  const evaluationSnapshotId = `snapshot:${name}:evaluation`;
  const releaseSnapshotId = `snapshot:${name}:release`;
  const rollbackSnapshotId = `snapshot:${name}:rollback`;
  const revisionDigest = sha("9");
  const previousRevisionDigest = sha("a");
  const auditCrossLinkDigest = sha("b");
  const rollbackAuditCrossLinkDigest = sha("c");
  const dataset = await Effect.runPromise(buildEvolutionDataset({
    id: datasetId,
    targetDigest: baselineDigest,
    sources: [
      EvolutionDatasetSource.make({
        kind: "target-specific",
        reference: `fixture:${targetClass}`,
        digest: sha("6"),
        classification: "internal",
      }),
    ],
    cases: datasetCases(),
    splitSeed: 17,
    split: { train: 0.6, validation: 0.2, holdout: 0.2 },
    createdAt: new Date(0).toISOString(),
  }));
  const holdout = dataset.cases.find((item) => item.split === "holdout");
  if (holdout === undefined) throw new Error("fixture has no holdout case");
  const candidate = EvolutionCandidate.make({
    id: candidateId,
    runId,
    targetDigest: baselineDigest,
    candidateDigest,
    patch: "-old\n+new\n",
    materializedContent: candidateContent,
    engineTraceDigest: sha("d"),
    usage: EvolutionCandidateUsage.make({
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 1,
      latencyMilliseconds: 10,
    }),
    constraints: [
      EvolutionConstraintResult.make({
        constraint: "all-required",
        passed: true,
        detail: "passed",
        evidenceDigests: [sha("e")],
      }),
    ],
    createdAt: new Date(0).toISOString(),
  });
  const baselineSnapshot = snapshot(baselineSnapshotId, {
    target: baselineDigest,
  });
  const evaluationSnapshot = snapshot(
    evaluationSnapshotId,
    { target: candidateDigest },
    baselineSnapshotId,
  );
  const releaseSnapshot = snapshot(
    releaseSnapshotId,
    {
      evolutionRevisionDigest: revisionDigest,
      evolutionActiveTargets: { [targetRef]: candidateDigest },
    },
    baselineSnapshotId,
  );
  const rollbackSnapshot = snapshot(
    rollbackSnapshotId,
    {
      evolutionRevisionDigest: previousRevisionDigest,
      evolutionActiveTargets: { [targetRef]: baselineDigest },
    },
    releaseSnapshotId,
  );
  const report = EvolutionEvaluationReport.make({
    id: reportId,
    runId,
    candidateId,
    evaluatorRef: "organization/evaluator/independent",
    authoringRouteDigest: AUTHOR_ROUTE,
    evaluationRouteDigest: JUDGE_ROUTE,
    holdoutDigest: dataset.splitDigests.holdout,
    baselineSnapshotId,
    candidateSnapshotId: evaluationSnapshotId,
    datasetDigest: dataset.digest,
    evaluationPlanDigest: sha("f"),
    environmentDigest: sha("1"),
    seed: 17,
    baselineCases: [
      EvolutionCaseResult.make({
        caseId: holdout.id,
        split: "holdout",
        snapshotId: baselineSnapshotId,
        metricValues: { correctness: 0.5 },
        costUsd: 0,
        latencyMilliseconds: 1,
        passed: true,
      }),
    ],
    candidateCases: [
      EvolutionCaseResult.make({
        caseId: holdout.id,
        split: "holdout",
        snapshotId: evaluationSnapshotId,
        metricValues: { correctness: 0.6 },
        costUsd: 0,
        latencyMilliseconds: 1,
        passed: true,
      }),
    ],
    metrics: [
      EvolutionMetricResult.make({
        metric: "correctness",
        split: "holdout",
        baseline: 0.5,
        candidate: 0.6,
        delta: 0.1,
        sampleCount: 1,
        passed: true,
      }),
    ],
    comparison: EvolutionStatisticalComparison.make({
      method: "paired-bootstrap",
      effectSize: 0.1,
      confidenceLevel: 0.95,
      confidenceIntervalLow: 0.01,
      confidenceIntervalHigh: 0.2,
      sampleCount: 1,
      multipleComparisonCorrection: "holm",
      passed: true,
    }),
    benchmarks: passingBenchmarks(targetClass),
    footprints: (["prompt", "inference", "runtime"] as const).map((category) =>
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
    ),
    passed: true,
    totalCostUsd: 1,
    totalLatencyMilliseconds: 10,
    createdAt: new Date(0).toISOString(),
  });
  const proposal: Proposal = Object.freeze({
    id: `proposal-${name}`,
    directory: `/proposal/${name}`,
    author: principalId(`author-${name}`),
    approver: principalId(`reviewer-${name}`),
    approvers: Object.freeze([principalId(`reviewer-${name}`)]),
    target: {
      ref: targetRef,
      digest: brandedDigest(baselineDigest),
    },
    signals: Object.freeze([]),
    artifacts: proposalArtifacts(),
    status: "approved",
    evolution: {
      runId,
      targetClass,
      riskClass,
      candidateDigest,
      baselineSnapshotId,
      candidateSnapshotId: evaluationSnapshotId,
      evaluationReportId: reportId,
      datasetDigest: dataset.digest,
    },
  });
  const rollback = EvolutionRollbackMetadata.make({
    previousTargetDigest: baselineDigest,
    previousRevisionDigest,
    previousSnapshotId: baselineSnapshotId,
    candidateRevisionDigest: revisionDigest,
    candidateSnapshotId: releaseSnapshotId,
  });
  const canaryRelease = EvolutionRelease.make({
    id: canaryReleaseId,
    runId,
    proposalId: proposal.id,
    candidateId,
    targetRef,
    targetDigest: candidateDigest,
    revisionDigest,
    snapshotId: releaseSnapshotId,
    rollback,
    promotedBy: "EvolutionReleasePromoter",
    promotedAt: new Date(1).toISOString(),
    status: "canary",
  });
  const release = EvolutionRelease.make({
    ...canaryRelease,
    id: releaseId,
    canaryReleaseId,
    auditCrossLinkDigest,
    status: "active",
  });
  const rollbackRelease = EvolutionRelease.make({
    ...release,
    id: rollbackReleaseId,
    previousReleaseId: releaseId,
    targetDigest: baselineDigest,
    revisionDigest: previousRevisionDigest,
    snapshotId: rollbackSnapshotId,
    auditCrossLinkDigest: rollbackAuditCrossLinkDigest,
    rollback: EvolutionRollbackMetadata.make({
      previousTargetDigest: candidateDigest,
      previousRevisionDigest: revisionDigest,
      previousSnapshotId: releaseSnapshotId,
      candidateRevisionDigest: previousRevisionDigest,
      candidateSnapshotId: rollbackSnapshotId,
    }),
    promotedBy: "EvolutionRollbackOperator",
    promotedAt: new Date(2).toISOString(),
    status: "active",
  });
  const run = EvolutionRun.make({
    id: runId,
    principalId: "EvolutionProposalAuthor",
    baselineSnapshotId,
    engineRef: targetClass === "code"
      ? "organization/evaluator/darwinian"
      : "organization/evaluator/dspy",
    engineKind: targetClass === "code" ? "darwinian" : "gepa",
    configurationDigest: sha("2"),
    signalIds: ["production-signal"],
    datasetId,
    datasetDigest: dataset.digest,
    optimizationSeed: 17,
    target: EvolutionTarget.make({
      targetClass,
      componentRef: targetRef,
      baselineDigest,
      riskClass,
      allowedMutationPaths: [`/${name}`],
      frozenPaths: [`/${name}.manifest`],
    }),
    budgets: EvolutionBudgets.make({
      maximumCandidates: 40,
      maximumTokens: 1000,
      maximumCostUsd: 25,
      maximumDurationMilliseconds: 1000,
      maximumConcurrency: 1,
    }),
    state: RolledBackRunState.make({
      releaseId,
      rollbackReleaseId,
      rolledBackAt: new Date(2).toISOString(),
    }),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(2).toISOString(),
  });
  const artifacts: EvolutionAcceptanceLineageArtifacts = {
    release,
    canaryRelease,
    rollbackRelease,
    run,
    candidate,
    dataset,
    report,
    proposal,
    baselineSnapshot,
    evaluationSnapshot,
    releaseSnapshot,
    rollbackSnapshot,
  };
  const evidence = EvolutionProductionReleaseEvidence.make({
    targetClass,
    riskClass,
    releaseId,
    canaryReleaseId,
    rollbackReleaseId,
    runId,
    proposalId: proposal.id,
    candidateId,
    datasetId,
    evaluationReportId: reportId,
    targetRef,
    targetDigest: candidateDigest,
    datasetDigest: dataset.digest,
    revisionDigest,
    baselineSnapshotId,
    evaluationSnapshotId,
    snapshotId: releaseSnapshotId,
    auditCrossLinkDigest,
    rollbackAuditCrossLinkDigest,
    epochTransactionDigest: sha("3"),
    rollbackEpochTransactionDigest: sha("4"),
    lineageDigest: evolutionProductionLineageDigest(artifacts),
    phaseGateReportDigest: sha("5"),
    productionDeploymentDigest: sha("6"),
    rollbackDrillDigest: sha("7"),
    reviewRecordDigests: [sha("8")],
    primaryImprovementRatio: targetClass === "tool-description" ? 0.05 : 0.1,
    broadRegressionRatio: 0,
    humanApproved: true,
    phaseGatePassed: true,
    fullChecksPassed: true,
    canaryPassed: true,
    protectedMetricsPassed: true,
    frozenSurfacesPassed: true,
    knownDefectHoldoutPassed: targetClass === "code",
    independentStyleIdentityPassed: targetClass === "prompt-segment",
    lineageRetained: true,
  });
  return { evidence, artifacts };
};

const artifactError = (artifact: string, id: string) =>
  EvolutionAcceptanceArtifactError.make({ artifact, id });

const fromMap = <A>(
  values: ReadonlyMap<string, A>,
  artifact: string,
  id: string,
) => {
  const value = values.get(id);
  return value === undefined
    ? Effect.fail(artifactError(artifact, id))
    : Effect.succeed(value);
};

const readerFor = (
  lineages: readonly {
    readonly artifacts: EvolutionAcceptanceLineageArtifacts;
  }[],
): EvolutionAcceptanceArtifactReader => {
  const artifacts = lineages.map((item) => item.artifacts);
  const releases = new Map(
    artifacts.flatMap((item) => [
      [item.release.id, item.release] as const,
      [item.canaryRelease.id, item.canaryRelease] as const,
      [item.rollbackRelease.id, item.rollbackRelease] as const,
    ]),
  );
  const runs = new Map(artifacts.map((item) => [item.run.id, item.run]));
  const candidates = new Map(
    artifacts.map((item) => [item.candidate.id, item.candidate]),
  );
  const datasets = new Map(
    artifacts.map((item) => [item.dataset.id, item.dataset]),
  );
  const reports = new Map(
    artifacts.map((item) => [item.report.id, item.report]),
  );
  const proposals = new Map(
    artifacts.map((item) => [item.proposal.id, item.proposal]),
  );
  const snapshots = new Map(
    artifacts.flatMap((item) => [
      [item.baselineSnapshot.id, item.baselineSnapshot] as const,
      [item.evaluationSnapshot.id, item.evaluationSnapshot] as const,
      [item.releaseSnapshot.id, item.releaseSnapshot] as const,
      [item.rollbackSnapshot.id, item.rollbackSnapshot] as const,
    ]),
  );
  return {
    release: (id) => fromMap(releases, "release", id),
    run: (id) => fromMap(runs, "run", id),
    candidate: (id) => fromMap(candidates, "candidate", id),
    dataset: (id) => fromMap(datasets, "dataset", id),
    report: (id) => fromMap(reports, "report", id),
    proposal: (id) => fromMap(proposals, "proposal", id),
    snapshot: (id) => fromMap(snapshots, "snapshot", id),
  };
};

const manifestFixture = async () => {
  const lineages = await Promise.all(
    ([
      "skill",
      "tool-description",
      "prompt-segment",
      "code",
    ] as const).map(makeLineage),
  );
  const companions = (["gepa", "miprov2", "darwinian"] as const).map(
    (engineKind, index) => {
      const imageDigest = sha(String(index + 6));
      return EvolutionCompanionDeploymentEvidence.make({
        engineKind,
        componentRef: `organization/evaluator/${engineKind}`,
        imageRef: `registry.example/elliott/${engineKind}@${imageDigest}`,
        imageDigest,
        registryPublicationDigest: sha("9"),
        vulnerabilityScanDigest: sha("a"),
        deploymentVerificationDigest: sha("b"),
        platforms: ["linux/arm64"],
        isolation: "container",
        registryPublished: true,
        vulnerabilityScanPassed: true,
        deploymentVerified: true,
      });
    },
  );
  const executors = ([
    "candidate-check",
    "evaluation-case",
    "broad-benchmark",
    "canary",
  ] as const).map((executorKind) =>
    EvolutionExecutorDeploymentEvidence.make({
      executorKind,
      componentRef: `organization/evaluator/${executorKind}`,
      endpointDigest: sha("c"),
      deploymentVerificationDigest: sha("d"),
      authentication: "bearer",
      snapshotResolution: "immutable",
      loopbackOnly: true,
      deployed: true,
    })
  );
  const manifest = EvolutionProductionAcceptanceManifest.make({
    id: "acceptance-production-2026-07-24",
    schemaVersion: 2,
    environment: "production",
    observedAt: new Date(0).toISOString(),
    companions,
    executors,
    routes: EvolutionRouteSeparationEvidence.make({
      authoringRouteDigest: AUTHOR_ROUTE,
      evaluationRouteDigest: JUDGE_ROUTE,
      authoringRouteAuthorized: true,
      evaluationRouteAuthorized: true,
    }),
    darwinianLegal: EvolutionDarwinianLegalEvidence.make({
      license: "AGPL-3.0",
      approvalRecordDigest: sha("1"),
      correspondingSourceDigest: sha("2"),
      noticesDigest: sha("3"),
      distributionApproved: true,
    }),
    ci: EvolutionCiAcceptanceEvidence.make({
      commitDigest: sha("4"),
      resultDigest: sha("5"),
      repositoryGatePassed: true,
      g01ThroughG25Passed: true,
      se01ThroughSe15Passed: true,
    }),
    scheduler: EvolutionSchedulerAcceptanceEvidence.make({
      jobId: "scheduled-production-cycle",
      runId: "evr_schedule1",
      proposalId: "proposal-scheduled",
      completionRecordDigest: sha("6"),
      unattended: true,
      canApprove: false,
      canPromote: false,
    }),
    codeCampaigns: (["C1", "C2"] as const).map((riskClass) =>
      EvolutionCodeCampaignEvidence.make({
        riskClass,
        runId: riskClass === "C1" ? "evr_codec001" : "evr_codec002",
        reportDigest: sha("7"),
        campaignPassed: true,
        knownDefectHoldoutPassed: true,
      })
    ),
    releases: lineages.map((item) => item.evidence),
  });
  return { manifest, lineages };
};

const persistProposal = async (
  root: string,
  proposal: Proposal,
): Promise<void> => {
  const directory = path.join(root, "proposals", proposal.id);
  await mkdir(path.join(directory, "support"), { recursive: true });
  const files = [
    ["proposal.yaml", proposalMetadata(proposal)],
    ["PROPOSAL.md", proposal.artifacts.rationale],
    ["target.yaml", proposal.artifacts.targetYaml],
    ["patch.diff", proposal.artifacts.patch],
    ["evidence.yaml", proposal.artifacts.evidenceYaml],
    ["permission-diff.yaml", proposal.artifacts.permissionDiffYaml],
    ["eval-plan.yaml", proposal.artifacts.evaluationPlanYaml],
    ...([
      ["candidate.yaml", proposal.artifacts.candidateYaml],
      ["lineage.yaml", proposal.artifacts.lineageYaml],
      ["dataset.yaml", proposal.artifacts.datasetYaml],
      ["comparison.yaml", proposal.artifacts.comparisonYaml],
      ["footprints.yaml", proposal.artifacts.footprintsYaml],
      ["benchmarks.yaml", proposal.artifacts.benchmarksYaml],
      ["rollback.yaml", proposal.artifacts.rollbackYaml],
    ] as const).flatMap(([name, content]) =>
      content === undefined ? [] : [[name, content] as const]
    ),
  ] as const;
  await Promise.all(
    files.map(([name, content]) =>
      writeFile(path.join(directory, name), content)
    ),
  );
  await Promise.all(
    Object.entries(proposal.artifacts.support).map(([name, content]) =>
      writeFile(path.join(directory, "support", name), content)
    ),
  );
};

const persistLineages = async (
  root: string,
  lineages: readonly {
    readonly artifacts: EvolutionAcceptanceLineageArtifacts;
  }[],
): Promise<void> => {
  const evolutionRoot = path.join(root, "evolution");
  const runs = makeEvolutionRunStore(evolutionRoot);
  const candidates = makeEvolutionCandidateStore(evolutionRoot);
  const datasets = makeEvolutionDatasetStore(evolutionRoot);
  const reports = makeEvolutionEvaluationReportStore(evolutionRoot);
  const releases = makeEvolutionReleaseStore(evolutionRoot);
  for (const { artifacts } of lineages) {
    await Effect.runPromise(runs.save(artifacts.run));
    await Effect.runPromise(candidates.save(artifacts.candidate));
    await Effect.runPromise(datasets.save(artifacts.dataset));
    await Effect.runPromise(reports.save(artifacts.report));
    await Effect.runPromise(releases.save(artifacts.canaryRelease));
    await Effect.runPromise(releases.save(artifacts.release));
    await Effect.runPromise(releases.save(artifacts.rollbackRelease));
    await persistProposal(root, artifacts.proposal);
    for (
      const persistedSnapshot of [
        artifacts.baselineSnapshot,
        artifacts.evaluationSnapshot,
        artifacts.releaseSnapshot,
        artifacts.rollbackSnapshot,
      ]
    ) {
      await mkdir(path.join(root, "snapshots"), { recursive: true });
      await writeFile(
        path.join(root, "snapshots", `${persistedSnapshot.id}.json`),
        `${JSON.stringify(persistedSnapshot)}\n`,
      );
    }
  }
};

describe("production evolution acceptance", () => {
  it("passes only when the manifest matches every durable lineage artifact", async () => {
    const fixture = await manifestFixture();
    const report = await Effect.runPromise(
      auditEvolutionProductionAcceptance(
        fixture.manifest,
        readerFor(fixture.lineages),
      ),
    );

    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("rejects a declared lineage digest when durable artifacts differ", async () => {
    const fixture = await manifestFixture();
    const [first, ...remaining] = fixture.manifest.releases;
    if (first === undefined) throw new Error("fixture has no release");
    const manifest = EvolutionProductionAcceptanceManifest.make({
      ...fixture.manifest,
      releases: [
        EvolutionProductionReleaseEvidence.make({
          ...first,
          lineageDigest: sha("0"),
        }),
        ...remaining,
      ],
    });

    const report = await Effect.runPromise(
      auditEvolutionProductionAcceptance(
        manifest,
        readerFor(fixture.lineages),
      ),
    );

    expect(report.passed).toBe(false);
    expect(report.findings.map((item) => item.requirement))
      .toContain("release.skill.lineage-digest");
  });

  it("loads complete lineage from runtime state and fails on a removed candidate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-acceptance-"));
    roots.push(root);
    const fixture = await manifestFixture();
    await persistLineages(root, fixture.lineages);
    const reader = await Effect.runPromise(
      makeFileEvolutionAcceptanceReader(root),
    );
    const passing = await Effect.runPromise(
      auditEvolutionProductionAcceptance(fixture.manifest, reader),
    );
    expect(passing.findings).toEqual([]);
    expect(passing.passed).toBe(true);

    const code = fixture.lineages.find((item) =>
      item.evidence.targetClass === "code"
    );
    if (code === undefined) throw new Error("fixture has no code lineage");
    await rm(path.join(
      root,
      "evolution",
      "candidates",
      code.artifacts.run.id,
      `${code.artifacts.candidate.id}.json`,
    ));
    const failing = await Effect.runPromise(
      auditEvolutionProductionAcceptance(fixture.manifest, reader),
    );
    expect(failing.passed).toBe(false);
    expect(failing.findings.map((item) => item.requirement))
      .toContain("release.code.candidate");
  });

  it("reports missing production facts without accepting local fixture claims", async () => {
    const fixture = await manifestFixture();
    const manifest = EvolutionProductionAcceptanceManifest.make({
      ...fixture.manifest,
      companions: [],
      routes: EvolutionRouteSeparationEvidence.make({
        ...fixture.manifest.routes,
        evaluationRouteDigest: fixture.manifest.routes.authoringRouteDigest,
      }),
      scheduler: EvolutionSchedulerAcceptanceEvidence.make({
        ...fixture.manifest.scheduler,
        unattended: false,
        canApprove: true,
      }),
      codeCampaigns: [],
      releases: fixture.manifest.releases.filter((item) =>
        item.targetClass !== "code"
      ),
    });

    const report = await Effect.runPromise(
      auditEvolutionProductionAcceptance(
        manifest,
        readerFor(fixture.lineages),
      ),
    );
    const requirements = report.findings.map((item) => item.requirement);

    expect(report.passed).toBe(false);
    expect(requirements).toContain("companion.gepa.present");
    expect(requirements).toContain("routes.separation");
    expect(requirements).toContain("scheduler.authority");
    expect(requirements).toContain("code-campaign.C1");
    expect(requirements).toContain("release.code.count");
  });

  it("rejects malformed evidence at the schema boundary", async () => {
    const fixture = await manifestFixture();
    const invalid = {
      ...fixture.manifest,
      companions: [{
        ...fixture.manifest.companions[0],
        imageDigest: "sha256:local-only",
      }],
    };

    await expect(
      Effect.runPromise(
        decodeEvolutionProductionAcceptanceManifest(
          "production-acceptance.json",
          invalid,
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "EvolutionDecodeError",
      artifact: "production-acceptance.json",
    });
  });
});
