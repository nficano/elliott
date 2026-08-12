import type { Posture } from "../config/postures/types";
import type { Digest, PrincipalId } from "../core/types";
import type { RecordAppender } from "../core/waist/types";

export const EXPLICIT_USER_CORRECTION_RANK = 1;
export const EXPLICIT_USER_RESULT_RANK = 2;
export const DETERMINISTIC_EVALUATOR_RANK = 3;
export const SUCCESSFUL_WORKAROUND_RANK = 4;
export const REPEATED_FAILURE_RANK = 5;
export const SELF_REFLECTION_RANK = 6;

export type LearningSignalRank =
  | typeof EXPLICIT_USER_CORRECTION_RANK
  | typeof EXPLICIT_USER_RESULT_RANK
  | typeof DETERMINISTIC_EVALUATOR_RANK
  | typeof SUCCESSFUL_WORKAROUND_RANK
  | typeof REPEATED_FAILURE_RANK
  | typeof SELF_REFLECTION_RANK;

export interface LearningSignal {
  readonly id: string;
  readonly rank: LearningSignalRank;
  readonly source: string;
  readonly evidence: string;
  readonly createdAt: string;
}

export interface ProposalTarget {
  readonly ref: string;
  readonly digest: Digest;
}

export interface ProposalArtifacts {
  readonly rationale: string;
  readonly targetYaml: string;
  readonly patch: string;
  readonly evidenceYaml: string;
  readonly permissionDiffYaml: string;
  readonly evaluationPlanYaml: string;
  readonly candidateYaml?: string;
  readonly lineageYaml?: string;
  readonly datasetYaml?: string;
  readonly comparisonYaml?: string;
  readonly footprintsYaml?: string;
  readonly benchmarksYaml?: string;
  readonly rollbackYaml?: string;
  readonly support: Readonly<Record<string, string>>;
}

export interface ProposalEvolutionMetadata {
  readonly runId: string;
  readonly targetClass:
    | "skill"
    | "tool-description"
    | "prompt-segment"
    | "code";
  readonly riskClass: "C1" | "C2" | "C3" | "C4";
  readonly candidateDigest: string;
  readonly baselineSnapshotId: string;
  readonly candidateSnapshotId: string;
  readonly evaluationReportId: string;
  readonly datasetDigest: string;
}

export type ProposalStatus =
  | "authored"
  | "evaluated"
  | "awaiting-review"
  | "approved"
  | "promoted"
  | "rejected"
  | "stale";

export interface Proposal {
  readonly id: string;
  readonly directory: string;
  readonly author: PrincipalId;
  readonly target: ProposalTarget;
  readonly signals: readonly LearningSignal[];
  readonly artifacts: ProposalArtifacts;
  readonly status: ProposalStatus;
  readonly approver?: PrincipalId;
  readonly approvers?: readonly PrincipalId[];
  readonly evolution?: ProposalEvolutionMetadata;
}

export type ProposalEvaluationStage =
  | "yaml-validation"
  | "markdown-validation"
  | "manifest-schema-validation"
  | "path-containment"
  | "permission-delta-analysis"
  | "static-security-analysis"
  | "unit-contract-tests"
  | "clean-context-evaluation"
  | "comparative-evaluation"
  | "adversarial-injection-tests"
  | "cost-latency-comparison"
  | "canary-execution";

export interface ProposalStageResult {
  readonly stage: ProposalEvaluationStage;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ProposalEvaluationReport {
  readonly proposalId: string;
  readonly results: readonly ProposalStageResult[];
  readonly passed: boolean;
}

export interface ProposalStageRunner {
  run(
    proposal: Proposal,
    stage: ProposalEvaluationStage,
  ): Promise<ProposalStageResult>;
}

export interface ProposalDeployment {
  activeDigest(ref: string): Promise<Digest>;
  promote(proposal: Proposal): Promise<void>;
}

export interface ProposalStoreConfig {
  readonly root: string;
  readonly records: RecordAppender;
}

export interface ProposalAuthorInput {
  readonly author: PrincipalId;
  readonly target: ProposalTarget;
  readonly signals: readonly LearningSignal[];
  readonly artifacts: ProposalArtifacts;
  readonly evolution?: ProposalEvolutionMetadata;
}

export type SkillLifecycle = "active" | "candidate" | "archived";

export interface LearnedSkill {
  readonly name: string;
  readonly markdown: string;
  readonly createdBy: "agent" | "operator";
  readonly pinned: boolean;
  readonly lifecycle: SkillLifecycle;
  readonly lastUsedAt: string;
  readonly hasExecutableOverlay: boolean;
}

export interface CuratorAction {
  readonly skill: string;
  readonly type: "archive" | "consolidate" | "patch";
  readonly recoverable: true;
}

export interface LearnSkillInput {
  readonly name: string;
  readonly source: string;
  readonly posture: Posture;
}

export interface LearnSkillResult {
  readonly skill: LearnedSkill;
  readonly activation: "active" | "proposal";
  readonly proposalId?: string;
}

export interface LearnProposalAuthor {
  propose(skill: LearnedSkill): Promise<string>;
}
