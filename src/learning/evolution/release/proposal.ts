import * as Effect from "effect/Effect";
import { stringify } from "yaml";
import { digest, principalId } from "../../../core/brands";
import { EvolutionPromotionError, EvolutionStaleTargetError } from "../errors";
import { renderEvolutionProposalReview } from "./proposal-review";
import type { EvolutionProposalAuthorInput } from "./types";

const caseSummary = (input: EvolutionProposalAuthorInput): string =>
  [...input.report.baselineCases, ...input.report.candidateCases]
    .map((result) =>
      JSON.stringify({
        caseId: result.caseId,
        split: result.split,
        snapshotId: result.snapshotId,
        metricValues: result.metricValues,
        passed: result.passed,
        ...(result.errorTag !== undefined && { errorTag: result.errorTag }),
      })
    )
    .join("\n");

const proposalReviewArtifacts = (input: EvolutionProposalAuthorInput) => ({
  candidateYaml: stringify({
    id: input.candidate.id,
    candidateDigest: input.candidate.candidateDigest,
    targetDigest: input.candidate.targetDigest,
    usage: input.candidate.usage,
    constraints: input.candidate.constraints,
  }),
  lineageYaml: stringify({
    candidateId: input.candidate.id,
    parentCandidateId: input.candidate.parentCandidateId ?? null,
    engineTraceDigest: input.candidate.engineTraceDigest,
  }),
  datasetYaml: stringify({
    datasetDigest: input.report.datasetDigest,
    holdoutDigest: input.report.holdoutDigest,
  }),
  comparisonYaml: stringify({
    metrics: input.report.metrics,
    comparison: input.report.comparison,
  }),
  footprintsYaml: stringify(input.report.footprints),
  benchmarksYaml: stringify(input.report.benchmarks),
  rollbackYaml: stringify({
    previousTargetDigest: input.run.target.baselineDigest,
    previousSnapshotId: input.run.baselineSnapshotId,
    candidateSnapshotId: input.report.candidateSnapshotId,
    activation: "immutable-prior-revision",
  }),
});

const proposalSupport = (input: EvolutionProposalAuthorInput) => ({
  "rejected-constraints.yaml": stringify(
    input.candidate.constraints.filter((result) => !result.passed),
  ),
  "case-summary.jsonl": caseSummary(input),
  "engine-summary.yaml": stringify({
    engineRef: input.run.engineRef,
    engineKind: input.run.engineKind,
    engineTraceDigest: input.candidate.engineTraceDigest,
    usage: input.candidate.usage,
  }),
});

const proposalArtifacts = (input: EvolutionProposalAuthorInput) => {
  const permissionDiffYaml = stringify({
    allowedMutationPaths: input.run.target.allowedMutationPaths,
    frozenPaths: input.run.target.frozenPaths,
    widenedCapabilities: [],
  });
  const evaluationPlanYaml = stringify({
    datasetDigest: input.report.datasetDigest,
    evaluationPlanDigest: input.report.evaluationPlanDigest,
    seed: input.report.seed,
    evaluatorRef: input.report.evaluatorRef,
    environmentDigest: input.report.environmentDigest,
    authoringRouteDigest: input.report.authoringRouteDigest,
    evaluationRouteDigest: input.report.evaluationRouteDigest,
  });
  return {
    rationale: renderEvolutionProposalReview(input),
    targetYaml: stringify(input.run.target),
    patch: input.candidate.patch,
    evidenceYaml: stringify(input.report),
    permissionDiffYaml,
    evaluationPlanYaml,
    ...proposalReviewArtifacts(input),
    support: proposalSupport(input),
  };
};

const matchingProposalCore = (
  input: EvolutionProposalAuthorInput,
): boolean =>
  input.run.state._tag === "evaluated"
  && input.run.state.passed
  && input.report.passed
  && input.report.runId === input.run.id
  && input.report.candidateId === input.candidate.id
  && input.candidate.runId === input.run.id;

const matchingProposalBindings = (
  input: EvolutionProposalAuthorInput,
): boolean =>
  input.candidate.targetDigest === input.run.target.baselineDigest
  && input.report.datasetDigest === input.run.datasetDigest
  && input.report.baselineSnapshotId === input.run.baselineSnapshotId
  && input.report.candidateSnapshotId !== input.run.baselineSnapshotId;

const requiredConstraintsComplete = (
  input: EvolutionProposalAuthorInput,
): boolean =>
  input.requiredConstraints.every((constraint) =>
    input.candidate.constraints.some((result) =>
      result.constraint === constraint && result.passed
    )
  );

const assertProposalEvidence = Effect.fn(
  "assertEvolutionProposalEvidence",
)(function*(input: EvolutionProposalAuthorInput) {
  if (!matchingProposalCore(input) || !matchingProposalBindings(input)) {
    return yield* EvolutionPromotionError.make({
      proposalId: "not-authored",
      stage: "proposal-evidence",
      reason:
        "a matching passing evaluated run, report, and candidate are required",
    });
  }
  if (!requiredConstraintsComplete(input)) {
    return yield* EvolutionPromotionError.make({
      proposalId: "not-authored",
      stage: "constraint-completeness",
      reason: "every required constraint must be present and passing",
    });
  }
  if (input.activeTargetDigest !== input.run.target.baselineDigest) {
    return yield* EvolutionStaleTargetError.make({
      targetRef: input.run.target.componentRef,
      expectedDigest: input.run.target.baselineDigest,
      activeDigest: input.activeTargetDigest,
    });
  }
});

export const authorEvolutionProposal = Effect.fn("authorEvolutionProposal")(
  function*(input: EvolutionProposalAuthorInput) {
    yield* assertProposalEvidence(input);
    return yield* Effect.tryPromise({
      try: () =>
        input.store.author({
          author: principalId(input.authorId),
          target: {
            ref: input.run.target.componentRef,
            digest: digest(input.run.target.baselineDigest),
          },
          signals: input.signals,
          artifacts: proposalArtifacts(input),
          evolution: {
            runId: input.run.id,
            targetClass: input.run.target.targetClass,
            riskClass: input.run.target.riskClass,
            candidateDigest: input.candidate.candidateDigest,
            baselineSnapshotId: input.run.baselineSnapshotId,
            candidateSnapshotId: input.report.candidateSnapshotId,
            evaluationReportId: input.report.id,
            datasetDigest: input.report.datasetDigest,
          },
        }),
      catch: (cause) =>
        EvolutionPromotionError.make({
          proposalId: "not-authored",
          stage: "persist-proposal",
          reason: "failed to persist review-ready Proposal",
          cause,
        }),
    });
  },
);
