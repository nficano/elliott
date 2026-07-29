import type { Effect } from "effect";
import type {
  EvolutionBenchmarkResult,
  EvolutionCandidate,
  EvolutionRun,
} from "../model/index";
import type { EvolutionTargetClassSchema } from "../model/index";
import type { EvolutionBenchmarkRunnerShape } from "../types";
import type { EvolutionWorkflowError } from "../types";

export interface ElliottCheckInput {
  readonly checkout: string;
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly baselinePassed: boolean;
  readonly timeoutMilliseconds: number;
}

export interface EvolutionBenchmarkStage {
  readonly benchmarkRef: string;
  readonly applicable: boolean;
  readonly notApplicableReason?: string;
  readonly run: (
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    context: EvolutionBenchmarkExecutionContext,
  ) => Effect.Effect<EvolutionBenchmarkResult, EvolutionWorkflowError>;
}

export interface EvolutionBenchmarkLadderInput {
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly stages: readonly EvolutionBenchmarkStage[];
  readonly context: EvolutionBenchmarkExecutionContext;
}

export interface EvolutionBenchmarkExecutionContext {
  readonly baselineSnapshotId: string;
  readonly candidateSnapshotId: string;
  readonly environmentDigest: string;
  readonly seed: number;
  readonly timeoutMilliseconds: number;
  readonly maximumCostUsd: number;
}

export interface EvolutionBenchmarkGateDefinition {
  readonly benchmarkRef: string;
  readonly operation: "runSubset" | "runFull" | "compareBaseline";
  readonly targetClasses: readonly (
    typeof EvolutionTargetClassSchema.Type
  )[];
}

export interface EvolutionBenchmarkStageFactoryInput {
  readonly runner: EvolutionBenchmarkRunnerShape;
  readonly targetClass: typeof EvolutionTargetClassSchema.Type;
}

// A prompt-injection / safety-bypass signature the native benchmark scans an
// evolution candidate's materialized artifact for.
export interface InjectionPattern {
  readonly id: string;
  readonly matcher: RegExp;
}

export interface PromptInjectionScan {
  readonly clean: boolean;
  readonly matches: readonly string[];
}
