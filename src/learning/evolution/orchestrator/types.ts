import type { Effect } from "effect";
import type { RecordAppender } from "../../../core/waist/types";
import type { FileProposalStore } from "../../proposals/index";
import type { LearningSignal, Proposal } from "../../types";
import type {
  EvolutionEvaluationPlan,
  EvolutionHarnessShape,
} from "../evaluation/types";
import type {
  EvolutionBudgets,
  EvolutionCandidate,
  EvolutionCodeSandboxContract,
  EvolutionDatasetManifest,
  EvolutionEvaluationReport,
  EvolutionRun,
  EvolutionTarget,
  OptimizationEngineResult,
} from "../model/index";
import type {
  EvolutionCandidateStoreShape,
  EvolutionDatasetStoreShape,
  EvolutionEvaluationReportStoreShape,
  EvolutionRunId,
  EvolutionRunStoreShape,
  EvolutionWorkflowError,
  OptimizationEngineShape,
} from "../types";

export interface EvolutionScopeInput {
  readonly principalId: string;
  readonly baselineSnapshotId: string;
  readonly engineRef: string;
  readonly engineKind: EvolutionRun["engineKind"];
  readonly configurationDigest: string;
  readonly target: EvolutionTarget;
  readonly budgets: EvolutionBudgets;
  readonly signalIds: readonly string[];
  readonly now: string;
}

export interface EvolutionOptimizeInput {
  readonly runId: EvolutionRunId;
  readonly baselineContent: string;
  readonly seed: number;
  readonly now: string;
  readonly codeSandbox?: EvolutionCodeSandboxContract;
}

export interface EvolutionProposalInput {
  readonly runId: EvolutionRunId;
  readonly candidateId: EvolutionCandidate["id"];
  readonly reportId: EvolutionEvaluationReport["id"];
  readonly authorId: string;
  readonly activeTargetDigest: string;
  readonly signals: readonly LearningSignal[];
  readonly requiredConstraints: readonly string[];
  readonly proposalStore: FileProposalStore;
  readonly now: string;
}

export interface EvolutionOrchestratorDependencies {
  readonly runs: EvolutionRunStoreShape;
  readonly candidates: EvolutionCandidateStoreShape;
  readonly datasets: EvolutionDatasetStoreShape;
  readonly reports: EvolutionEvaluationReportStoreShape;
  readonly engine: OptimizationEngineShape;
  readonly harness: EvolutionHarnessShape;
  readonly records: RecordAppender;
  readonly candidateValidator?: EvolutionCandidateValidatorShape;
}

export interface EvolutionCandidateValidatorShape {
  readonly validate: (
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    baselineContent: string,
    codeSandbox?: EvolutionCodeSandboxContract,
  ) => Effect.Effect<EvolutionCandidate, EvolutionWorkflowError>;
}

export interface EvolutionTrustedCodeCheckerShape {
  readonly check: (
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    codeSandbox: EvolutionCodeSandboxContract,
  ) => Effect.Effect<
    readonly EvolutionCandidate["constraints"][number][],
    EvolutionWorkflowError
  >;
}

export interface EvolutionOptimizationCompletion {
  readonly input: EvolutionOptimizeInput;
  readonly run: EvolutionRun;
  readonly candidates: readonly EvolutionCandidate[];
}

export interface EvolutionOptimizationResultInput {
  readonly input: EvolutionOptimizeInput;
  readonly run: EvolutionRun;
  readonly result: OptimizationEngineResult;
}

export interface EvolutionRecordInput {
  readonly run: EvolutionRun;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvolutionExceededBudget {
  readonly budget: string;
  readonly observed: number;
  readonly limit: number;
}

export interface EvolutionOrchestratorShape {
  readonly scope: (
    input: EvolutionScopeInput,
  ) => Effect.Effect<EvolutionRun, EvolutionWorkflowError>;
  readonly attachDataset: (
    runId: EvolutionRunId,
    dataset: EvolutionDatasetManifest,
    now: string,
  ) => Effect.Effect<EvolutionRun, EvolutionWorkflowError>;
  readonly optimize: (
    input: EvolutionOptimizeInput,
  ) => Effect.Effect<readonly EvolutionCandidate[], EvolutionWorkflowError>;
  readonly pause: (
    runId: EvolutionRunId,
    now: string,
  ) => Effect.Effect<EvolutionRun, EvolutionWorkflowError>;
  readonly resume: (
    input: EvolutionOptimizeInput,
  ) => Effect.Effect<readonly EvolutionCandidate[], EvolutionWorkflowError>;
  readonly evaluate: (
    plan: EvolutionEvaluationPlan,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionWorkflowError>;
  readonly recordEvaluation: (
    report: EvolutionEvaluationReport,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionWorkflowError>;
  readonly propose: (
    input: EvolutionProposalInput,
  ) => Effect.Effect<Proposal, EvolutionWorkflowError>;
  readonly cancel: (
    runId: EvolutionRunId,
    now: string,
    reason: string,
  ) => Effect.Effect<EvolutionRun, EvolutionWorkflowError>;
}
