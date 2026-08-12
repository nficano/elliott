import * as Effect from "effect/Effect";
import { EvolutionDatasetError } from "../errors";
import {
  type EvolutionDatasetManifest,
  EvolutionOptimizerDatasetView,
} from "../model/index";

export const buildOptimizerDatasetView = Effect.fn(
  "buildOptimizerDatasetView",
)(function*(dataset: EvolutionDatasetManifest) {
  if (!dataset.holdoutSealed) {
    return yield* EvolutionDatasetError.make({
      operation: "build-optimizer-view",
      reason: "holdout must be sealed before optimizer access",
      caseIds: [],
    });
  }
  return EvolutionOptimizerDatasetView.make({
    id: dataset.id,
    targetDigest: dataset.targetDigest,
    digest: dataset.digest,
    splitSeed: dataset.splitSeed,
    trainDigest: dataset.splitDigests.train,
    validationDigest: dataset.splitDigests.validation,
    classification: dataset.classification,
    sources: dataset.sources,
    trainCases: dataset.cases.filter((item) => item.split === "train"),
    validationCases: dataset.cases.filter(
      (item) => item.split === "validation",
    ),
    holdoutSealed: true,
  });
});
