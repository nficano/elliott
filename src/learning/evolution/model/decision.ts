import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";

export class EvolutionRejectionDecision
  extends Schema.TaggedClass<EvolutionRejectionDecision>()("rejection", {
    runId: EvolutionRunIdSchema,
    reason: Schema.String,
  })
{}

export class EvolutionShortlistDecision
  extends Schema.TaggedClass<EvolutionShortlistDecision>()("shortlist", {
    runId: EvolutionRunIdSchema,
    candidateIds: Schema.Array(EvolutionCandidateIdSchema),
  })
{}

export class EvolutionProposalDecision
  extends Schema.TaggedClass<EvolutionProposalDecision>()("proposal", {
    runId: EvolutionRunIdSchema,
    candidateId: EvolutionCandidateIdSchema,
    reportId: EvolutionEvaluationReportIdSchema,
    proposalId: Schema.String,
  })
{}

export class EvolutionStaleDecision
  extends Schema.TaggedClass<EvolutionStaleDecision>()("stale", {
    runId: EvolutionRunIdSchema,
    expectedDigest: Schema.String,
    activeDigest: Schema.String,
  })
{}

export class EvolutionPromotionDecision
  extends Schema.TaggedClass<EvolutionPromotionDecision>()("promotion", {
    runId: EvolutionRunIdSchema,
    releaseId: EvolutionReleaseIdSchema,
  })
{}

export class EvolutionRollbackDecision
  extends Schema.TaggedClass<EvolutionRollbackDecision>()("rollback", {
    runId: EvolutionRunIdSchema,
    releaseId: EvolutionReleaseIdSchema,
    rollbackReleaseId: EvolutionReleaseIdSchema,
  })
{}

export const EvolutionDecisionSchema = Schema.Union([
  EvolutionRejectionDecision,
  EvolutionShortlistDecision,
  EvolutionProposalDecision,
  EvolutionStaleDecision,
  EvolutionPromotionDecision,
  EvolutionRollbackDecision,
]);
