import {
  EvolutionDatasetSource,
  type EvolutionUnsplitDatasetCase,
} from "../../model/index";
import type { EvolutionDatasetSourceResult } from "./types";

const sourceClassification = (
  cases: readonly EvolutionUnsplitDatasetCase[],
): EvolutionUnsplitDatasetCase["classification"] => {
  if (cases.some((item) => item.classification === "restricted")) {
    return "restricted";
  }
  if (cases.some((item) => item.classification === "confidential")) {
    return "confidential";
  }
  return cases.some((item) => item.classification === "internal")
    ? "internal"
    : "public";
};

export const targetSpecificDatasetSource = (
  targetRef: string,
  sourceDigest: string,
  cases: readonly EvolutionUnsplitDatasetCase[],
): EvolutionDatasetSourceResult => ({
  source: EvolutionDatasetSource.make({
    kind: "target-specific",
    reference: targetRef,
    digest: sourceDigest,
    classification: sourceClassification(cases),
  }),
  cases,
});
