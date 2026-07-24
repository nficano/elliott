import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";

export class EvolutionTrajectoryStep
  extends Schema.Class<EvolutionTrajectoryStep>("EvolutionTrajectoryStep")({
    sequence: Schema.Int,
    operation: Schema.String,
    inputDigest: Schema.String,
    outputDigest: Schema.String,
    score: Schema.optionalKey(Schema.Number),
    feedback: Schema.optionalKey(Schema.String),
    toolRef: Schema.optionalKey(Schema.String),
    latencyMilliseconds: Schema.Int,
    errorTag: Schema.optionalKey(Schema.String),
  })
{}

export class EvolutionTrajectory
  extends Schema.Class<EvolutionTrajectory>("EvolutionTrajectory")({
    runId: EvolutionRunIdSchema,
    candidateId: Schema.optionalKey(EvolutionCandidateIdSchema),
    snapshotId: Schema.String,
    routeDigest: Schema.String,
    steps: Schema.Array(EvolutionTrajectoryStep),
    totalCostUsd: Schema.Number,
    digest: Schema.String,
  })
{}
