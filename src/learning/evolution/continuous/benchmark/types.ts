import type { RecordAppender } from "../../../../core/waist/types";
import type { FrameId } from "../../../../security/ifc/types";
import type {
  EvolutionBenchmarkResult,
  EvolutionBudgets,
  EvolutionPerformanceProjection,
  EvolutionTarget,
} from "../../model/index";
import type { EvolutionBenchmarkRunnerShape } from "../../types";
import type { EvolutionProjectionStore } from "../types";

export interface RecurringEvolutionBenchmarkInput {
  readonly target: EvolutionTarget;
  readonly baselineContent: string;
  readonly principalId: string;
  readonly snapshotId: string;
  readonly frame: FrameId;
  readonly budgets: EvolutionBudgets;
  readonly environmentDigest: string;
  readonly seed: number;
  readonly runner: EvolutionBenchmarkRunnerShape;
  readonly projections: EvolutionProjectionStore;
  readonly records: RecordAppender;
  readonly now?: () => Date;
}

export interface RecurringEvolutionBenchmarkResult {
  readonly projection: EvolutionPerformanceProjection;
  readonly results: readonly EvolutionBenchmarkResult[];
  readonly reportDigest: string;
  readonly passed: boolean;
}
