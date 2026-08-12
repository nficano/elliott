import type { Effect } from "effect";
import type { AuditLog } from "../../../audit/log";
import type { ConfigurationActivationManager } from "../../../config/activation/index";
import type { ConfigurationRevision } from "../../../config/activation/types";
import type { EpochRegistry } from "../../../core/epoch/epochs";
import type { SnapshotStore } from "../../../core/snapshot/snapshot";
import type { SnapshotInput } from "../../../core/snapshot/types";
import type { PrincipalId } from "../../../core/types";
import type { RecordAppender } from "../../../core/waist/types";
import type { FileProposalStore } from "../../proposals/index";
import type { Proposal } from "../../types";
import type { LearningSignal } from "../../types";
import type {
  EvolutionActiveTargetReader,
  EvolutionReleaseControllerShape,
} from "../application/types";
import type {
  EvolutionPromotionError,
  EvolutionStaleTargetError,
} from "../errors";
import type {
  EvolutionBaselineReport,
  EvolutionCandidate,
  EvolutionEvaluationReport,
  EvolutionPerformanceProjection,
  EvolutionRelease,
  EvolutionReleaseMonitorReport,
  EvolutionRun,
} from "../model/index";
import type {
  EvolutionBaselineReportStoreShape,
  EvolutionCandidateStoreShape,
  EvolutionEvaluationReportStoreShape,
  EvolutionReleaseMonitorReportStoreShape,
  EvolutionReleaseStoreShape,
  EvolutionRunStoreShape,
} from "../types";

export interface EvolutionPreparedRelease {
  readonly revisionDigest: string;
  readonly snapshotId: string;
  readonly previousRevisionDigest: string;
  readonly previousSnapshotId: string;
  readonly touchedEpochs: readonly string[];
}

export interface EvolutionPromotionActivation extends EvolutionPreparedRelease {
  readonly auditCrossLinkDigest: string;
}

export interface EvolutionPromotionInput {
  readonly proposal: Proposal;
  readonly report: EvolutionEvaluationReport;
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly promoterId: PrincipalId;
  readonly activeTargetDigest: string;
  readonly now: string;
  readonly promoterCapabilities: readonly string[];
  readonly previousRelease?: EvolutionRelease;
}

export interface EvolutionReleaseHooks {
  readonly recordPromotionIntent: (
    input: EvolutionPromotionInput,
  ) => Effect.Effect<void, EvolutionPromotionError>;
  readonly prepareCandidate: (
    input: EvolutionPromotionInput,
  ) => Effect.Effect<EvolutionPreparedRelease, EvolutionPromotionError>;
  readonly recordCanaryIntent: (
    release: EvolutionRelease,
  ) => Effect.Effect<void, EvolutionPromotionError>;
  readonly runCanary: (
    release: EvolutionRelease,
  ) => Effect.Effect<boolean, EvolutionPromotionError>;
  readonly recordCanaryFailed: (
    release: EvolutionRelease,
  ) => Effect.Effect<void, EvolutionPromotionError>;
  readonly activateCandidate: (
    input: EvolutionPromotionInput,
    prepared: EvolutionPreparedRelease,
  ) => Effect.Effect<EvolutionPromotionActivation, EvolutionPromotionError>;
  readonly recordPromoted: (
    release: EvolutionRelease,
  ) => Effect.Effect<void, EvolutionPromotionError>;
  readonly recordRollbackIntent: (
    release: EvolutionRelease,
    principalId: PrincipalId,
  ) => Effect.Effect<void, EvolutionPromotionError>;
  readonly activatePriorRevision: (
    release: EvolutionRelease,
  ) => Effect.Effect<EvolutionPromotionActivation, EvolutionPromotionError>;
  readonly recordRolledBack: (
    release: EvolutionRelease,
  ) => Effect.Effect<void, EvolutionPromotionError>;
}

export interface EvolutionRollbackInput {
  readonly release: EvolutionRelease;
  readonly principalId: PrincipalId;
  readonly now: string;
  readonly capabilities: readonly string[];
  readonly activeTargetDigest: string;
}

export interface EvolutionReleaseStores {
  readonly releases: EvolutionReleaseStoreShape;
  readonly runs: EvolutionRunStoreShape;
}

export interface EvolutionProposalAuthorInput {
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly report: EvolutionEvaluationReport;
  readonly signals: readonly LearningSignal[];
  readonly requiredConstraints: readonly string[];
  readonly authorId: string;
  readonly activeTargetDigest: string;
  readonly store: FileProposalStore;
}

export type EvolutionProposalAuthorRequest = Omit<
  EvolutionProposalAuthorInput,
  "store"
>;

export interface EvolutionProposalAuthorShape {
  readonly author: (
    input: EvolutionProposalAuthorRequest,
  ) => Effect.Effect<
    Proposal,
    EvolutionPromotionError | EvolutionStaleTargetError
  >;
}

export interface EvolutionKernelReleaseConfig {
  readonly activation: ConfigurationActivationManager;
  readonly snapshots: SnapshotStore;
  readonly epochs: EpochRegistry;
  readonly records: AuditLog;
  readonly workspaceId: string;
  readonly candidateRevision: (
    input: EvolutionPromotionInput,
  ) => ConfigurationRevision;
  readonly revisionByDigest: (
    digest: string,
  ) => ConfigurationRevision | undefined;
  readonly candidateSnapshot: (
    input: EvolutionPromotionInput,
    revision: ConfigurationRevision,
  ) => SnapshotInput;
  readonly rollbackSnapshot: (
    release: EvolutionRelease,
    revision: ConfigurationRevision,
  ) => SnapshotInput;
  readonly canary: (release: EvolutionRelease) => Promise<boolean>;
}

export interface EvolutionKernelReleaseRecordInput {
  readonly type: string;
  readonly proposalId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvolutionRuntimeTargetRevision {
  readonly revision: ConfigurationRevision;
  readonly targets: Readonly<
    Record<string, { readonly digest: string; readonly content: string; }>
  >;
}

export interface EvolutionRuntimeReleaseControllerInput {
  readonly stateRoot: string;
  readonly workspaceId: string;
  readonly snapshots: SnapshotStore;
  readonly epochs: EpochRegistry;
  readonly records: AuditLog;
  readonly proposals: FileProposalStore;
  readonly runs: EvolutionRunStoreShape;
  readonly candidates: EvolutionCandidateStoreShape;
  readonly reports: EvolutionEvaluationReportStoreShape;
  readonly releases: EvolutionReleaseStoreShape;
  readonly currentSnapshotId: () => string | undefined;
  readonly publishSnapshotId: (snapshotId: string) => void;
  readonly canary: (release: EvolutionRelease) => Promise<boolean>;
  readonly notify?: (message: string) => Promise<void>;
}

export interface EvolutionRuntimeReleaseBinding {
  readonly targets: EvolutionActiveTargetReader;
  readonly controller: EvolutionReleaseControllerShape;
}

export interface EvolutionReleaseMonitorPolicy {
  readonly minimumSampleCount: number;
  readonly maximumSuccessRegressionRatio: number;
  readonly maximumBenchmarkRegressionRatio: number;
  readonly maximumCostRegressionRatio: number;
}

export interface EvolutionReleaseMonitorInput {
  readonly release: EvolutionRelease;
  readonly baseline: EvolutionBaselineReport;
  readonly comparison: EvolutionEvaluationReport;
  readonly projection: EvolutionPerformanceProjection;
  readonly policy?: EvolutionReleaseMonitorPolicy;
  readonly now?: () => Date;
}

export interface EvolutionReleaseMonitorDependencies {
  readonly reports: EvolutionReleaseMonitorReportStoreShape;
  readonly records: RecordAppender;
  readonly notify?: (message: string) => Promise<void>;
}

export interface EvolutionReleaseMonitorShape {
  readonly monitor: (
    input: EvolutionReleaseMonitorInput,
  ) => Effect.Effect<EvolutionReleaseMonitorReport, EvolutionPromotionError>;
}

export interface EvolutionReleaseMonitoringStores {
  readonly baselines: EvolutionBaselineReportStoreShape;
  readonly comparisons: EvolutionEvaluationReportStoreShape;
  readonly releases: EvolutionReleaseStoreShape;
}
