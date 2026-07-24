import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";
import { NonNegativeFiniteSchema, NonNegativeIntSchema } from "./numeric";

const MAXIMUM_PATCH_CHARACTERS = 2_000_000;
const MAXIMUM_MATERIALIZED_CHARACTERS = 5_000_000;
const MAXIMUM_CONSTRAINT_RESULTS = 256;

const CandidatePatchSchema = Schema.String.check(
  Schema.isMaxLength(MAXIMUM_PATCH_CHARACTERS),
);
const CandidateMaterializedContentSchema = Schema.String.check(
  Schema.isMaxLength(MAXIMUM_MATERIALIZED_CHARACTERS),
);

export class EvolutionCandidateUsage
  extends Schema.Class<EvolutionCandidateUsage>("EvolutionCandidateUsage")({
    inputTokens: NonNegativeIntSchema,
    outputTokens: NonNegativeIntSchema,
    costUsd: NonNegativeFiniteSchema,
    latencyMilliseconds: NonNegativeIntSchema,
  })
{}

export class EvolutionConstraintResult
  extends Schema.Class<EvolutionConstraintResult>(
    "EvolutionConstraintResult",
  )({
    constraint: Schema.String,
    passed: Schema.Boolean,
    detail: Schema.String,
    evidenceDigests: Schema.Array(Schema.String),
  })
{}

export class EvolutionCandidate
  extends Schema.Class<EvolutionCandidate>("EvolutionCandidate")({
    id: EvolutionCandidateIdSchema,
    runId: EvolutionRunIdSchema,
    targetDigest: Schema.String,
    candidateDigest: Schema.String,
    parentCandidateId: Schema.optionalKey(EvolutionCandidateIdSchema),
    patch: CandidatePatchSchema,
    materializedContent: Schema.optionalKey(CandidateMaterializedContentSchema),
    engineTraceDigest: Schema.String,
    validationScore: Schema.optionalKey(
      Schema.Number.check(Schema.isFinite()),
    ),
    usage: EvolutionCandidateUsage,
    constraints: Schema.Array(EvolutionConstraintResult).check(
      Schema.isMaxLength(MAXIMUM_CONSTRAINT_RESULTS),
    ),
    createdAt: Schema.String,
  })
{}
