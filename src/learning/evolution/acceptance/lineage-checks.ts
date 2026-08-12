import * as Effect from "effect/Effect";
import { hashBytes } from "../../../core/digest";
import { requiredEvolutionReviewCount } from "../../proposals/evolution-codec";
import { proposalApprovers } from "../../proposals/reviews";
import { REQUIRED_PREPROMOTION_BENCHMARK_GATES } from "../benchmarks/required";
import { validateEvolutionDatasetManifest } from "../datasets/builder";
import { acceptanceFinding } from "./finding";
import { evolutionProductionLineageDigest } from "./lineage-digest";
import { snapshotFindings } from "./snapshot-checks";
import type { EvolutionAcceptanceLineageAuditInput } from "./types";

const releaseFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence } = input;
  const releaseMatches = [
    artifacts.release.id === evidence.releaseId,
    artifacts.release.status === "active",
    artifacts.release.canaryReleaseId === evidence.canaryReleaseId,
    artifacts.release.runId === evidence.runId,
    artifacts.release.proposalId === evidence.proposalId,
    artifacts.release.candidateId === evidence.candidateId,
    artifacts.release.targetRef === evidence.targetRef,
    artifacts.release.targetDigest === evidence.targetDigest,
    artifacts.release.revisionDigest === evidence.revisionDigest,
    artifacts.release.snapshotId === evidence.snapshotId,
    artifacts.release.auditCrossLinkDigest === evidence.auditCrossLinkDigest,
  ].every(Boolean);
  const canaryMatches = [
    artifacts.canaryRelease.id === evidence.canaryReleaseId,
    artifacts.canaryRelease.status === "canary",
    artifacts.canaryRelease.runId === evidence.runId,
    artifacts.canaryRelease.proposalId === evidence.proposalId,
    artifacts.canaryRelease.candidateId === evidence.candidateId,
  ].every(Boolean);
  return releaseMatches && canaryMatches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.lineage`,
      "active and canary releases do not match the production evidence",
    )];
};

const rollbackFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence } = input;
  const matches = [
    artifacts.rollbackRelease.id === evidence.rollbackReleaseId,
    artifacts.rollbackRelease.status === "active",
    artifacts.rollbackRelease.previousReleaseId === evidence.releaseId,
    artifacts.rollbackRelease.runId === evidence.runId,
    artifacts.rollbackRelease.proposalId === evidence.proposalId,
    artifacts.rollbackRelease.candidateId === evidence.candidateId,
    artifacts.rollbackRelease.auditCrossLinkDigest
      === evidence.rollbackAuditCrossLinkDigest,
    artifacts.rollbackRelease.targetDigest
      === artifacts.release.rollback.previousTargetDigest,
    artifacts.run.state._tag === "rolled-back",
    artifacts.run.state._tag === "rolled-back"
    && artifacts.run.state.releaseId === evidence.releaseId,
    artifacts.run.state._tag === "rolled-back"
    && artifacts.run.state.rollbackReleaseId === evidence.rollbackReleaseId,
  ].every(Boolean);
  return matches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.rollback`,
      "durable rollback release and terminal run state do not match",
    )];
};

const runAndCandidateFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence } = input;
  const runMatches = [
    artifacts.run.id === evidence.runId,
    artifacts.run.target.targetClass === evidence.targetClass,
    artifacts.run.target.riskClass === evidence.riskClass,
    artifacts.run.target.componentRef === evidence.targetRef,
    artifacts.run.datasetId === evidence.datasetId,
    artifacts.run.datasetDigest === evidence.datasetDigest,
    artifacts.run.baselineSnapshotId === evidence.baselineSnapshotId,
  ].every(Boolean);
  const materialized = artifacts.candidate.materializedContent
    ?? artifacts.candidate.patch;
  const candidateMatches = [
    artifacts.candidate.id === evidence.candidateId,
    artifacts.candidate.runId === evidence.runId,
    artifacts.candidate.targetDigest === artifacts.run.target.baselineDigest,
    artifacts.candidate.candidateDigest === evidence.targetDigest,
    hashBytes(materialized) === artifacts.candidate.candidateDigest,
    artifacts.candidate.constraints.length > 0,
    artifacts.candidate.constraints.every((item) => item.passed),
  ].every(Boolean);
  return runMatches && candidateMatches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.run-candidate`,
      "run or candidate identity, digest, constraints, or target is invalid",
    )];
};

const proposalFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence } = input;
  const evolution = artifacts.proposal.evolution;
  const approvers = proposalApprovers(artifacts.proposal);
  const matches = [
    artifacts.proposal.id === evidence.proposalId,
    artifacts.proposal.status === "approved",
    artifacts.proposal.target.ref === evidence.targetRef,
    artifacts.proposal.target.digest === artifacts.run.target.baselineDigest,
    approvers.length >= requiredEvolutionReviewCount(evolution),
    approvers.length <= evidence.reviewRecordDigests.length,
    !approvers.includes(artifacts.proposal.author),
    evolution?.runId === evidence.runId,
    evolution?.targetClass === evidence.targetClass,
    evolution?.riskClass === evidence.riskClass,
    evolution?.candidateDigest === evidence.targetDigest,
    evolution?.baselineSnapshotId === evidence.baselineSnapshotId,
    evolution?.candidateSnapshotId === evidence.evaluationSnapshotId,
    evolution?.evaluationReportId === evidence.evaluationReportId,
    evolution?.datasetDigest === evidence.datasetDigest,
  ].every(Boolean);
  return matches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.proposal`,
      "approved Proposal and review lineage do not match durable artifacts",
    )];
};

const completeReportGates = (
  input: EvolutionAcceptanceLineageAuditInput,
): boolean => {
  const { report } = input.artifacts;
  const required = REQUIRED_PREPROMOTION_BENCHMARK_GATES.filter((gate) =>
    gate.targetClasses.includes(input.evidence.targetClass)
  );
  const benchmarksPass = required.every((gate) =>
    report.benchmarks.some((result) =>
      result.benchmarkRef === gate.benchmarkRef && result.passed
    )
  );
  const footprintsPass = ["prompt", "inference", "runtime"].every((category) =>
    report.footprints.some((result) =>
      result.category === category && result.passed
    )
  );
  return benchmarksPass && footprintsPass;
};

const reportFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence, manifest } = input;
  const report = artifacts.report;
  const matches = [
    report.id === evidence.evaluationReportId,
    report.runId === evidence.runId,
    report.candidateId === evidence.candidateId,
    report.datasetDigest === evidence.datasetDigest,
    report.holdoutDigest === artifacts.dataset.splitDigests.holdout,
    report.baselineSnapshotId === evidence.baselineSnapshotId,
    report.candidateSnapshotId === evidence.evaluationSnapshotId,
    report.authoringRouteDigest === manifest.routes.authoringRouteDigest,
    report.evaluationRouteDigest === manifest.routes.evaluationRouteDigest,
    report.seed === artifacts.run.optimizationSeed,
    report.passed,
    report.comparison.passed,
    report.comparison.sampleCount > 0,
    report.metrics.some((metric) =>
      metric.split === "holdout" && metric.passed
    ),
    completeReportGates(input),
  ].every(Boolean);
  return matches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.evaluation`,
      "evaluation report lacks matching holdout, route, statistical, or gate evidence",
    )];
};

export const auditAcceptanceLineageArtifacts = Effect.fn(
  "auditAcceptanceLineageArtifacts",
)(function*(input: EvolutionAcceptanceLineageAuditInput) {
  const datasetValid = yield* validateEvolutionDatasetManifest(
    input.artifacts.dataset,
  ).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  const findings = [
    ...releaseFindings(input),
    ...rollbackFindings(input),
    ...runAndCandidateFindings(input),
    ...proposalFindings(input),
    ...reportFindings(input),
    ...snapshotFindings(input),
  ];
  if (
    !datasetValid
    || input.artifacts.dataset.id !== input.evidence.datasetId
    || input.artifacts.dataset.digest !== input.evidence.datasetDigest
    || input.artifacts.dataset.targetDigest
      !== input.artifacts.run.target.baselineDigest
  ) {
    findings.push(acceptanceFinding(
      `release.${input.evidence.targetClass}.dataset`,
      "sealed dataset identity or recomputed integrity is invalid",
    ));
  }
  if (
    evolutionProductionLineageDigest(input.artifacts)
      !== input.evidence.lineageDigest
  ) {
    findings.push(acceptanceFinding(
      `release.${input.evidence.targetClass}.lineage-digest`,
      "computed durable artifact lineage digest does not match the manifest",
    ));
  }
  return findings;
});
