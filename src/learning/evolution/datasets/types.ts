import type {
  EvolutionDatasetCase,
  EvolutionDatasetIdSchema,
  EvolutionDatasetSource,
} from "../model/index";

type EvolutionDatasetId = typeof EvolutionDatasetIdSchema.Type;
export type EvolutionDatasetSplit = "train" | "validation" | "holdout";

export interface EvolutionDatasetRatios {
  readonly train: number;
  readonly validation: number;
  readonly holdout: number;
}

export interface EvolutionUnsplitCase {
  readonly id: string;
  readonly groupId: string;
  readonly input: EvolutionDatasetCase["input"];
  readonly expected: EvolutionDatasetCase["expected"];
  readonly rubric?: string;
  readonly classification: EvolutionDatasetCase["classification"];
  readonly sourceDigests: readonly string[];
  readonly timeoutMilliseconds: number;
  readonly maximumCostUsd: number;
  readonly allowedEffects: readonly string[];
}

export interface EvolutionDatasetBuildInput {
  readonly id: EvolutionDatasetId;
  readonly targetDigest: string;
  readonly splitSeed: number;
  readonly split: EvolutionDatasetRatios;
  readonly sources: readonly EvolutionDatasetSource[];
  readonly cases: readonly EvolutionUnsplitCase[];
  readonly createdAt: string;
}

export interface EvolutionDatasetDigestInput {
  readonly targetDigest: string;
  readonly splitSeed: number;
  readonly splitDigests: {
    readonly train: string;
    readonly validation: string;
    readonly holdout: string;
  };
  readonly sources: EvolutionDatasetBuildInput["sources"];
}
