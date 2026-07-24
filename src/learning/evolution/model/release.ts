import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";

export class EvolutionRollbackMetadata
  extends Schema.Class<EvolutionRollbackMetadata>(
    "EvolutionRollbackMetadata",
  )({
    previousTargetDigest: Schema.String,
    previousRevisionDigest: Schema.String,
    previousSnapshotId: Schema.String,
    candidateRevisionDigest: Schema.String,
    candidateSnapshotId: Schema.String,
  })
{}

export class EvolutionRelease
  extends Schema.Class<EvolutionRelease>("EvolutionRelease")({
    id: EvolutionReleaseIdSchema,
    runId: EvolutionRunIdSchema,
    proposalId: Schema.String,
    candidateId: EvolutionCandidateIdSchema,
    targetRef: Schema.String,
    targetDigest: Schema.String,
    revisionDigest: Schema.String,
    snapshotId: Schema.String,
    previousReleaseId: Schema.optionalKey(EvolutionReleaseIdSchema),
    canaryReleaseId: Schema.optionalKey(EvolutionReleaseIdSchema),
    auditCrossLinkDigest: Schema.optionalKey(Schema.String),
    rollback: EvolutionRollbackMetadata,
    promotedBy: Schema.String,
    promotedAt: Schema.String,
    status: Schema.Literals(["canary", "active", "rolled-back", "failed"]),
  })
{}

export class EvolutionReleaseProjectionOperation
  extends Schema.Class<EvolutionReleaseProjectionOperation>(
    "EvolutionReleaseProjectionOperation",
  )({
    operation: Schema.Literals(["render", "publish"]),
    proposalId: Schema.String,
    release: Schema.optionalKey(EvolutionRelease),
  })
{}
