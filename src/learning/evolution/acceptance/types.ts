import type { Effect } from "effect";
import type { Snapshot } from "../../../core/snapshot/types";
import type { Proposal } from "../../types";
import type { EvolutionAcceptanceArtifactError } from "../errors";
import type {
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionDatasetManifest,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionProductionAcceptanceManifest,
  EvolutionProductionReleaseEvidence,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRun,
  EvolutionRunIdSchema,
} from "../model/index";

export interface EvolutionAcceptanceArtifactReader {
  readonly release: (
    id: typeof EvolutionReleaseIdSchema.Type,
  ) => Effect.Effect<EvolutionRelease, EvolutionAcceptanceArtifactError>;
  readonly run: (
    id: typeof EvolutionRunIdSchema.Type,
  ) => Effect.Effect<EvolutionRun, EvolutionAcceptanceArtifactError>;
  readonly candidate: (
    id: typeof EvolutionCandidateIdSchema.Type,
  ) => Effect.Effect<EvolutionCandidate, EvolutionAcceptanceArtifactError>;
  readonly dataset: (
    id: typeof EvolutionDatasetIdSchema.Type,
  ) => Effect.Effect<
    EvolutionDatasetManifest,
    EvolutionAcceptanceArtifactError
  >;
  readonly report: (
    id: typeof EvolutionEvaluationReportIdSchema.Type,
  ) => Effect.Effect<
    EvolutionEvaluationReport,
    EvolutionAcceptanceArtifactError
  >;
  readonly proposal: (
    id: string,
  ) => Effect.Effect<Proposal, EvolutionAcceptanceArtifactError>;
  readonly snapshot: (
    id: string,
  ) => Effect.Effect<Snapshot, EvolutionAcceptanceArtifactError>;
}

export interface EvolutionAcceptanceLineageArtifacts {
  readonly release: EvolutionRelease;
  readonly canaryRelease: EvolutionRelease;
  readonly rollbackRelease: EvolutionRelease;
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly dataset: EvolutionDatasetManifest;
  readonly report: EvolutionEvaluationReport;
  readonly proposal: Proposal;
  readonly baselineSnapshot: Snapshot;
  readonly evaluationSnapshot: Snapshot;
  readonly releaseSnapshot: Snapshot;
  readonly rollbackSnapshot: Snapshot;
}

export interface EvolutionAcceptanceLineageAuditInput {
  readonly manifest: EvolutionProductionAcceptanceManifest;
  readonly evidence: EvolutionProductionReleaseEvidence;
  readonly artifacts: EvolutionAcceptanceLineageArtifacts;
}
