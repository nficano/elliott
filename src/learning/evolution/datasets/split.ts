import { createHash } from "node:crypto";
import {
  EvolutionDatasetCase,
  type EvolutionDatasetManifest,
} from "../model/index";
import type {
  EvolutionDatasetRatios,
  EvolutionDatasetSplit,
  EvolutionUnsplitCase,
} from "./types";

const HASH_WIDTH = 8;
const HASH_RADIX = 16;
const HASH_SPACE = 0xFF_FF_FF_FF;

const groupUnit = (groupId: string, seed: number): number => {
  const prefix = createHash("sha256")
    .update(`${seed}:${groupId}`)
    .digest("hex")
    .slice(0, HASH_WIDTH);
  return Number.parseInt(prefix, HASH_RADIX) / HASH_SPACE;
};

const selectSplit = (
  unit: number,
  ratios: EvolutionDatasetRatios,
): EvolutionDatasetSplit => {
  if (unit < ratios.train) return "train";
  if (unit < ratios.train + ratios.validation) return "validation";
  return "holdout";
};

export const splitDatasetCases = (
  cases: readonly EvolutionUnsplitCase[],
  seed: number,
  ratios: EvolutionDatasetRatios,
): readonly EvolutionDatasetCase[] => {
  const splitByGroup = new Map<string, EvolutionDatasetSplit>();
  return cases
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((item) => {
      const split = splitByGroup.get(item.groupId)
        ?? selectSplit(groupUnit(item.groupId, seed), ratios);
      splitByGroup.set(item.groupId, split);
      return EvolutionDatasetCase.make({ ...item, split });
    });
};

export const casesForSplit = (
  dataset: EvolutionDatasetManifest,
  split: EvolutionDatasetSplit,
): readonly EvolutionDatasetCase[] =>
  dataset.cases.filter((item) => item.split === split);
