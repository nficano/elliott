import type { Effect } from "effect";
import type { SessionEvolutionStore } from "../../../../memory/session-store/evolution";
import type {
  FeedbackEvidence,
  ToolCallEvidence,
} from "../../../../memory/types";
import type {
  EvolutionClassificationSchema,
  EvolutionDatasetSource,
  EvolutionTarget,
  EvolutionUnsplitDatasetCase,
} from "../../model/index";
import type { EvolutionWorkflowError } from "../../types";

export interface EvolutionSyntheticCaseGenerator {
  readonly generate: (
    target: EvolutionTarget,
    count: number,
  ) => Effect.Effect<
    readonly EvolutionUnsplitDatasetCase[],
    EvolutionWorkflowError
  >;
}

export interface EvolutionGoldenSourceInput {
  readonly filePath: string;
  readonly classification: typeof EvolutionClassificationSchema.Type;
  readonly sourceDigest: string;
}

export interface EvolutionSessionSourceInput {
  readonly targetRef: string;
  readonly classification: typeof EvolutionClassificationSchema.Type;
  readonly sourceDigest: string;
  readonly feedback: readonly FeedbackEvidence[];
  readonly toolCalls: readonly ToolCallEvidence[];
}

export interface EvolutionSessionStoreSourceInput {
  readonly targetRef: string;
  readonly classification: typeof EvolutionClassificationSchema.Type;
  readonly sourceDigest: string;
  readonly store: SessionEvolutionStore;
}

export interface EvolutionBenchmarkSourceInput {
  readonly benchmarkRef: string;
  readonly taskIds: readonly string[];
  readonly sourceDigest: string;
  readonly classification: typeof EvolutionClassificationSchema.Type;
}

export interface EvolutionDatasetSourceResult {
  readonly source: EvolutionDatasetSource;
  readonly cases: readonly EvolutionUnsplitDatasetCase[];
}
