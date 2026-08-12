import type { Effect } from "effect";
import type { DataClassification } from "../../../core/types";
import type { RecordAppender } from "../../../core/waist/types";
import type { FeedbackEvidence, ToolCallEvidence } from "../../../memory/types";
import type { ScheduledJob } from "../../../scheduler/types";
import type { ScheduledJobExecutor } from "../../../scheduler/types";
import type { FrameId } from "../../../security/ifc/types";
import type {
  EvolutionCliRequest,
  EvolutionControlPlaneExecutor,
} from "../cli/types";
import type {
  EvolutionPerformanceProjection,
  EvolutionRiskClassSchema,
  EvolutionSignal,
  EvolutionTargetClassSchema,
} from "../model/index";
import type { EvolutionWorkflowError } from "../types";

export interface EvolutionTriageInput {
  readonly signals: readonly EvolutionSignal[];
  readonly cooldownTargetRefs: ReadonlySet<string>;
  readonly activeTargetRefs: ReadonlySet<string>;
  readonly activeRunCount: number;
  readonly maximumConcurrentRuns: number;
  readonly monthlySpentUsd: number;
  readonly monthlyBudgetUsd: number;
  readonly maximumRiskClass: typeof EvolutionRiskClassSchema.Type;
}

export interface EvolutionTriageResult {
  readonly selected?: EvolutionSignal;
  readonly score?: number;
  readonly reason:
    | "selected"
    | "concurrency-exhausted"
    | "monthly-budget-exhausted"
    | "no-eligible-signal";
}

export interface EvolutionScheduleInput {
  readonly jobId: string;
  readonly principalId: string;
  readonly agentRef: string;
  readonly targetRef: string;
  readonly targetDigest: string;
  readonly engineRef: string;
  readonly runAt: string;
  readonly recurrenceCron?: string;
  readonly timeZone?: string;
}

export interface EvolutionBenchmarkScheduleInput {
  readonly jobId: string;
  readonly principalId: string;
  readonly agentRef: string;
  readonly targetRef: string;
  readonly targetDigest: string;
  readonly runAt: string;
  readonly cron: string;
  readonly timeZone?: string;
}

export interface EvolutionScheduledCampaign {
  readonly job: ScheduledJob;
  readonly mayApprove: false;
  readonly mayPromote: false;
}

export interface EvolutionScheduledOperatorInput {
  readonly executor: EvolutionControlPlaneExecutor;
  readonly currentSnapshotId: () => string | undefined;
  readonly grantedCapabilities: readonly string[];
  readonly campaignDecision?: (
    targetRef: string,
  ) => Promise<
    | "skip"
    | "budget-exhausted"
    | { readonly signalId: string; }
  >;
  readonly permitCampaign?: (targetRef: string) => Promise<boolean>;
  readonly completeCampaign?: (targetRef: string) => Promise<void>;
  readonly runBenchmark?: (
    input: {
      readonly targetRef: string;
      readonly targetDigest: string;
      readonly principalId: string;
      readonly snapshotId: string;
      readonly frame: FrameId;
    },
  ) => Promise<{
    readonly passed: boolean;
    readonly reportDigest: string;
  }>;
  readonly onBenchmarkCompleted?: (
    targetRef: string,
    passed: boolean,
    reportDigest: string,
  ) => Promise<void>;
  readonly onProposalReady?: (
    proposalId: string,
    runId: string,
  ) => Promise<void>;
  readonly onRunCompleted?: (
    runId: string,
    candidateId: string,
    passed: boolean,
  ) => Promise<void>;
  readonly onStaleTarget?: (targetRef: string) => Promise<void>;
}

export type EvolutionScheduledOperator = ScheduledJobExecutor;

export interface EvolutionScheduledRunSummary {
  readonly runId: string;
  readonly state: string;
  readonly candidateIds: readonly string[];
}

export interface EvolutionScheduledExecutionContext {
  readonly snapshotId: string;
  readonly requireCapability: (capability: string) => void;
  readonly execute: (request: EvolutionCliRequest) => Promise<unknown>;
}

export interface EvolutionNotificationSink {
  readonly notify: (
    event:
      | "regression-detected"
      | "run-completed"
      | "proposal-ready"
      | "stale-target"
      | "budget-exhausted"
      | "rollback",
    references: Readonly<Record<string, string>>,
  ) => Promise<void>;
}

export interface EvolutionProjectionStore {
  readonly put: (projection: EvolutionPerformanceProjection) => void;
  readonly get: (
    targetRef: string,
  ) => EvolutionPerformanceProjection | undefined;
  readonly list: () => readonly EvolutionPerformanceProjection[];
}

export interface EvolutionContinuousDetected {
  readonly signal: EvolutionSignal;
  readonly runId: string;
}

export interface EvolutionContinuousDatasetReady
  extends EvolutionContinuousDetected
{
  readonly datasetId: string;
}

export interface EvolutionContinuousOptimized
  extends EvolutionContinuousDatasetReady
{
  readonly candidateId: string;
  readonly costUsd: number;
}

export interface EvolutionContinuousEvaluated
  extends EvolutionContinuousOptimized
{
  readonly reportId: string;
}

export interface EvolutionContinuousCycleResult
  extends EvolutionContinuousEvaluated
{
  readonly proposalId: string;
}

export interface EvolutionContinuousStageHandlers {
  readonly detect: (
    signal: EvolutionSignal,
  ) => Effect.Effect<EvolutionContinuousDetected, EvolutionWorkflowError>;
  readonly buildDataset: (
    input: EvolutionContinuousDetected,
  ) => Effect.Effect<EvolutionContinuousDatasetReady, EvolutionWorkflowError>;
  readonly optimize: (
    input: EvolutionContinuousDatasetReady,
  ) => Effect.Effect<EvolutionContinuousOptimized, EvolutionWorkflowError>;
  readonly evaluate: (
    input: EvolutionContinuousOptimized,
  ) => Effect.Effect<EvolutionContinuousEvaluated, EvolutionWorkflowError>;
  readonly authorProposal: (
    input: EvolutionContinuousEvaluated,
  ) => Effect.Effect<EvolutionContinuousCycleResult, EvolutionWorkflowError>;
}

export interface EvolutionContinuousWorkflowShape {
  readonly run: (
    signal: EvolutionSignal,
  ) => Effect.Effect<EvolutionContinuousCycleResult, EvolutionWorkflowError>;
  readonly mayApprove: false;
  readonly mayPromote: false;
}

export interface EvolutionContinuousControllerShape {
  readonly cycle: (
    input: EvolutionTriageInput,
  ) => Effect.Effect<
    {
      readonly triage: EvolutionTriageResult;
      readonly result?: EvolutionContinuousCycleResult;
    },
    EvolutionWorkflowError
  >;
  readonly mayApprove: false;
  readonly mayPromote: false;
}

export interface EvolutionSignalDetectionInput {
  readonly id: string;
  readonly targetRef: string;
  readonly targetClass: typeof EvolutionTargetClassSchema.Type;
  readonly riskClass: typeof EvolutionRiskClassSchema.Type;
  readonly strength: number;
  readonly usageFrequency: number;
  readonly expectedImpact: number;
  readonly evaluatorConfidence: number;
  readonly estimatedCost: number;
  readonly source: EvolutionSignal["source"];
  readonly evidenceDigest: string;
  readonly classification: DataClassification;
  readonly createdAt: string;
}

export interface EvolutionFeedbackSignalInput {
  readonly feedback: FeedbackEvidence;
  readonly targetClass: typeof EvolutionTargetClassSchema.Type;
  readonly riskClass: typeof EvolutionRiskClassSchema.Type;
  readonly usageFrequency: number;
  readonly expectedImpact: number;
  readonly estimatedCost: number;
  readonly classification: DataClassification;
}

export interface EvolutionToolFailureSignalInput {
  readonly toolCall: ToolCallEvidence;
  readonly targetRef: string;
  readonly riskClass: typeof EvolutionRiskClassSchema.Type;
  readonly usageFrequency: number;
  readonly expectedImpact: number;
  readonly estimatedCost: number;
  readonly classification: DataClassification;
}

export interface EvolutionBenchmarkSignalInput {
  readonly id: string;
  readonly targetRef: string;
  readonly targetClass: typeof EvolutionTargetClassSchema.Type;
  readonly riskClass: typeof EvolutionRiskClassSchema.Type;
  readonly scoreDelta: number;
  readonly evaluatorConfidence: number;
  readonly evidenceDigest: string;
  readonly estimatedCost: number;
  readonly classification: DataClassification;
  readonly createdAt: string;
}

export interface EvolutionSignalDetectorShape {
  readonly detect: (
    input: EvolutionSignalDetectionInput,
    records: RecordAppender,
  ) => Effect.Effect<EvolutionSignal, EvolutionWorkflowError>;
}
