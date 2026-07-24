import { requiredEvolutionReviewCount } from "../../proposals/evolution-codec";
import { proposalApprovers } from "../../proposals/reviews";
import { REQUIRED_PREPROMOTION_BENCHMARK_GATES } from "../benchmarks/required";
import type { EvolutionPromotionInput } from "./types";

const REQUIRED_FOOTPRINT_CATEGORIES = [
  "prompt",
  "inference",
  "runtime",
] as const;

const completeBenchmarkEvidence = (input: EvolutionPromotionInput): boolean => {
  const passing = new Set(
    input.report.benchmarks
      .filter((result) => result.passed)
      .map((result) => result.benchmarkRef),
  );
  return REQUIRED_PREPROMOTION_BENCHMARK_GATES.every((gate) =>
    passing.has(gate.benchmarkRef)
  );
};

const completeFootprintEvidence = (input: EvolutionPromotionInput): boolean => {
  const passing = new Set(
    input.report.footprints
      .filter((result) => result.passed)
      .map((result) => result.category),
  );
  return REQUIRED_FOOTPRINT_CATEGORIES.every((category) =>
    passing.has(category)
  );
};

const completeHoldoutEvidence = (input: EvolutionPromotionInput): boolean =>
  input.report.metrics.some((metric) =>
    metric.split === "holdout" && metric.passed
  )
  && input.report.baselineCases.some((result) =>
    result.split === "holdout"
    && result.snapshotId === input.report.baselineSnapshotId
  )
  && input.report.candidateCases.some((result) =>
    result.split === "holdout"
    && result.snapshotId === input.report.candidateSnapshotId
  );

const matchingEvolutionIdentity = (
  input: EvolutionPromotionInput,
): boolean => {
  const evolution = input.proposal.evolution;
  return evolution !== undefined
    && evolution.runId === input.run.id
    && evolution.targetClass === input.run.target.targetClass
    && evolution.riskClass === input.run.target.riskClass
    && evolution.candidateDigest === input.candidate.candidateDigest;
};

const matchingEvolutionArtifacts = (
  input: EvolutionPromotionInput,
): boolean => {
  const evolution = input.proposal.evolution;
  return evolution !== undefined
    && evolution.baselineSnapshotId === input.run.baselineSnapshotId
    && evolution.candidateSnapshotId === input.report.candidateSnapshotId
    && evolution.evaluationReportId === input.report.id
    && evolution.datasetDigest === input.report.datasetDigest;
};

const matchingProposalMetadata = (input: EvolutionPromotionInput): boolean =>
  input.proposal.target.ref === input.run.target.componentRef
  && input.proposal.target.digest === input.run.target.baselineDigest
  && matchingEvolutionIdentity(input)
  && matchingEvolutionArtifacts(input);

const matchingProposalState = (input: EvolutionPromotionInput): boolean =>
  input.proposal.status === "approved"
  && proposalApprovers(input.proposal).length
    >= requiredEvolutionReviewCount(input.proposal.evolution)
  && input.run.state._tag === "awaiting-review"
  && input.run.state.proposalId === input.proposal.id;

const matchingCandidate = (input: EvolutionPromotionInput): boolean =>
  input.candidate.runId === input.run.id
  && input.candidate.targetDigest === input.run.target.baselineDigest;

const matchingReport = (input: EvolutionPromotionInput): boolean =>
  input.report.passed
  && input.report.runId === input.run.id
  && input.report.candidateId === input.candidate.id
  && input.report.datasetDigest === input.run.datasetDigest
  && input.report.baselineSnapshotId === input.run.baselineSnapshotId;

const matchingCoreEvidence = (input: EvolutionPromotionInput): boolean =>
  matchingProposalState(input)
  && matchingCandidate(input)
  && matchingReport(input)
  && matchingProposalMetadata(input);

const completeConstraintEvidence = (input: EvolutionPromotionInput): boolean =>
  input.candidate.constraints.length > 0
  && input.candidate.constraints.every((constraint) => constraint.passed);

export const promotionEvidenceFailure = (
  input: EvolutionPromotionInput,
): string | undefined => {
  const checks = [
    {
      passed: matchingCoreEvidence(input),
      reason: "Proposal approval and a matching passing report are required",
    },
    {
      passed: input.report.authoringRouteDigest
        !== input.report.evaluationRouteDigest,
      reason: "independent evaluation route evidence is required",
    },
    {
      passed: input.report.comparison.passed
        && input.report.comparison.sampleCount > 0,
      reason: "a passing paired statistical comparison is required",
    },
    {
      passed: completeHoldoutEvidence(input),
      reason: "complete Snapshot-bound holdout evidence is required",
    },
    {
      passed: completeBenchmarkEvidence(input),
      reason: "every pre-promotion benchmark gate must be signed and passing",
    },
    {
      passed: completeFootprintEvidence(input),
      reason: "prompt, inference, and runtime footprint gates are required",
    },
    {
      passed: completeConstraintEvidence(input),
      reason: "every candidate constraint must be present and passing",
    },
  ];
  return checks.find((check) => !check.passed)?.reason;
};
