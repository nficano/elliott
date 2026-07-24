import type { Effect } from "effect";
import type { RecordAppender } from "../../core/waist/types";
import type { FileProposalStore } from "../proposals/index";
import type {
  EvolutionAuthorityError,
  EvolutionBudgetError,
  EvolutionConstraintError,
  EvolutionContainmentError,
  EvolutionDatasetError,
  EvolutionDecodeError,
  EvolutionEngineError,
  EvolutionEvaluationError,
  EvolutionNotFoundError,
  EvolutionPersistenceError,
  EvolutionPromotionError,
  EvolutionStaleTargetError,
  EvolutionTransitionError,
} from "./errors";
import type { EvolutionHarnessShape } from "./evaluation/types";
import type {
  EvolutionBaselineReport,
  EvolutionBaselineReportIdSchema,
  EvolutionBenchmarkOperation,
  EvolutionBenchmarkResult,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionDatasetManifest,
  EvolutionDatasetOperation,
  EvolutionEvaluationOperation,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionReleaseMonitorReport,
  EvolutionReleaseMonitorReportIdSchema,
  EvolutionReleaseProjectionOperation,
  EvolutionRun,
  EvolutionRunIdSchema,
  EvolutionRunStateSchema,
  EvolutionTarget,
  EvolutionTargetOperation,
  OptimizationEngineCapabilities,
  OptimizationEngineRequest,
  OptimizationEngineResult,
} from "./model/index";

export type EvolutionRunId = typeof EvolutionRunIdSchema.Type;
export type EvolutionCandidateId = typeof EvolutionCandidateIdSchema.Type;
export type EvolutionDatasetId = typeof EvolutionDatasetIdSchema.Type;
export type EvolutionReleaseId = typeof EvolutionReleaseIdSchema.Type;
export type EvolutionEvaluationReportId =
  typeof EvolutionEvaluationReportIdSchema.Type;
export type EvolutionBaselineReportId =
  typeof EvolutionBaselineReportIdSchema.Type;
export type EvolutionReleaseMonitorReportId =
  typeof EvolutionReleaseMonitorReportIdSchema.Type;
export type EvolutionRunState = typeof EvolutionRunStateSchema.Type;

export type EvolutionStoreError =
  | EvolutionPersistenceError
  | EvolutionDecodeError
  | EvolutionNotFoundError
  | EvolutionContainmentError;

export type EvolutionWorkflowError =
  | EvolutionStoreError
  | EvolutionTransitionError
  | EvolutionAuthorityError
  | EvolutionStaleTargetError
  | EvolutionBudgetError
  | EvolutionEngineError
  | EvolutionEvaluationError
  | EvolutionPromotionError
  | EvolutionDatasetError
  | EvolutionConstraintError;

export interface EvolutionRunStoreShape {
  readonly save: (
    run: EvolutionRun,
  ) => Effect.Effect<EvolutionRun, EvolutionStoreError>;
  readonly get: (
    id: EvolutionRunId,
  ) => Effect.Effect<EvolutionRun, EvolutionStoreError>;
  readonly list: () => Effect.Effect<
    readonly EvolutionRun[],
    EvolutionStoreError
  >;
}

export interface EvolutionCandidateStoreShape {
  readonly save: (
    candidate: EvolutionCandidate,
  ) => Effect.Effect<EvolutionCandidate, EvolutionStoreError>;
  readonly get: (
    id: EvolutionCandidateId,
  ) => Effect.Effect<EvolutionCandidate, EvolutionStoreError>;
  readonly listForRun: (
    runId: EvolutionRunId,
  ) => Effect.Effect<readonly EvolutionCandidate[], EvolutionStoreError>;
}

export interface EvolutionDatasetStoreShape {
  readonly save: (
    dataset: EvolutionDatasetManifest,
  ) => Effect.Effect<EvolutionDatasetManifest, EvolutionStoreError>;
  readonly get: (
    id: EvolutionDatasetId,
  ) => Effect.Effect<EvolutionDatasetManifest, EvolutionStoreError>;
}

export interface EvolutionReleaseStoreShape {
  readonly save: (
    release: EvolutionRelease,
  ) => Effect.Effect<EvolutionRelease, EvolutionStoreError>;
  readonly get: (
    id: EvolutionReleaseId,
  ) => Effect.Effect<EvolutionRelease, EvolutionStoreError>;
  readonly activeForTarget: (
    targetRef: string,
  ) => Effect.Effect<EvolutionRelease, EvolutionStoreError>;
  readonly list: () => Effect.Effect<
    readonly EvolutionRelease[],
    EvolutionStoreError
  >;
}

export interface EvolutionEvaluationReportStoreShape {
  readonly save: (
    report: EvolutionEvaluationReport,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionStoreError>;
  readonly get: (
    id: EvolutionEvaluationReportId,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionStoreError>;
}

export interface EvolutionBaselineReportStoreShape {
  readonly save: (
    report: EvolutionBaselineReport,
  ) => Effect.Effect<EvolutionBaselineReport, EvolutionStoreError>;
  readonly get: (
    id: EvolutionBaselineReportId,
  ) => Effect.Effect<EvolutionBaselineReport, EvolutionStoreError>;
  readonly listForRun: (
    runId: EvolutionRunId,
  ) => Effect.Effect<readonly EvolutionBaselineReport[], EvolutionStoreError>;
}

export interface EvolutionReleaseMonitorReportStoreShape {
  readonly save: (
    report: EvolutionReleaseMonitorReport,
  ) => Effect.Effect<EvolutionReleaseMonitorReport, EvolutionStoreError>;
  readonly get: (
    id: EvolutionReleaseMonitorReportId,
  ) => Effect.Effect<EvolutionReleaseMonitorReport, EvolutionStoreError>;
}

export interface EvolutionTargetRegistryShape {
  readonly invoke: (
    operation: EvolutionTargetOperation,
  ) => Effect.Effect<EvolutionTarget, EvolutionWorkflowError>;
  readonly activeDigest: (
    targetRef: string,
  ) => Effect.Effect<string, EvolutionWorkflowError>;
}

export interface OptimizationEngineShape {
  readonly describeCapabilities: () => Effect.Effect<
    OptimizationEngineCapabilities,
    EvolutionWorkflowError
  >;
  readonly optimize: (
    request: OptimizationEngineRequest,
  ) => Effect.Effect<OptimizationEngineResult, EvolutionWorkflowError>;
  readonly pause: (
    runId: EvolutionRunId,
  ) => Effect.Effect<string, EvolutionWorkflowError>;
  readonly resume: (
    resumeToken: string,
  ) => Effect.Effect<OptimizationEngineResult, EvolutionWorkflowError>;
  readonly cancel: (
    runId: EvolutionRunId,
  ) => Effect.Effect<void, EvolutionWorkflowError>;
}

export interface EvolutionDatasetBuilderShape {
  readonly invoke: (
    operation: EvolutionDatasetOperation,
  ) => Effect.Effect<EvolutionDatasetManifest, EvolutionWorkflowError>;
}

export interface EvolutionEvaluationRunnerShape {
  readonly invoke: (
    operation: typeof EvolutionEvaluationOperation.Type,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionWorkflowError>;
}

export interface EvolutionBenchmarkRunnerShape {
  readonly invoke: (
    operation: EvolutionBenchmarkOperation,
  ) => Effect.Effect<EvolutionBenchmarkResult, EvolutionWorkflowError>;
}

export interface EvolutionReleaseProjectionShape {
  readonly invoke: (
    operation: EvolutionReleaseProjectionOperation,
  ) => Effect.Effect<string, EvolutionWorkflowError>;
}

export interface EvolutionStoreBundle {
  readonly runs: EvolutionRunStoreShape;
  readonly candidates: EvolutionCandidateStoreShape;
  readonly datasets: EvolutionDatasetStoreShape;
  readonly reports: EvolutionEvaluationReportStoreShape;
  readonly releases: EvolutionReleaseStoreShape;
}

export interface EvolutionExternalServices {
  readonly engine: OptimizationEngineShape;
  readonly harness: EvolutionHarnessShape;
  readonly records: RecordAppender;
  readonly proposalStore: FileProposalStore;
  readonly targetRegistry: EvolutionTargetRegistryShape;
  readonly datasetBuilder: EvolutionDatasetBuilderShape;
  readonly evaluationRunner: EvolutionEvaluationRunnerShape;
  readonly benchmarkRunner: EvolutionBenchmarkRunnerShape;
  readonly releaseProjection: EvolutionReleaseProjectionShape;
}

export interface EvolutionRuntimeLayerInput extends EvolutionExternalServices {
  readonly root: string;
}

export interface EvolutionTestLayerInput extends EvolutionExternalServices {
  readonly stores: EvolutionStoreBundle;
}
