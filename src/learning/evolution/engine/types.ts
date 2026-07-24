import type {
  ComponentUseEvidence,
  EvaluationLabelEvidence,
  ModelSelectionEvidence,
  ToolCallEvidence,
} from "../../../memory/types";
import type { OptimizationEngineCapabilities } from "../model/index";
import type { EvolutionCandidateId, EvolutionRunId } from "../types";

export interface HttpOptimizationEngineConfig {
  readonly endpoint: string;
  readonly engineRef: string;
  readonly capabilities: OptimizationEngineCapabilities;
  readonly fetch?: typeof globalThis.fetch;
}

export interface EvolutionTraceInput {
  readonly runId: EvolutionRunId;
  readonly candidateId?: EvolutionCandidateId;
  readonly snapshotId: string;
  readonly routeDigest: string;
  readonly componentUses: readonly ComponentUseEvidence[];
  readonly toolCalls: readonly ToolCallEvidence[];
  readonly labels: readonly EvaluationLabelEvidence[];
  readonly modelSelections: readonly ModelSelectionEvidence[];
  readonly totalCostUsd: number;
}

export interface EvolutionEngineIsolationInput {
  readonly engineRef: string;
  readonly isolation:
    | "declarative"
    | "in-process"
    | "process"
    | "container"
    | "remote";
  readonly image: string;
  readonly hasRepositoryCredentials: boolean;
  readonly hasActiveTreeWrite: boolean;
  readonly hasContainerRuntimeSocket: boolean;
  readonly holdoutReadable: boolean;
}
