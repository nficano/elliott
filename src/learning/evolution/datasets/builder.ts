import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";
import { EvolutionDatasetError } from "../errors";
import {
  type EvolutionClassificationSchema,
  EvolutionDatasetManifest,
} from "../model/index";
import { validateDatasetLeakage } from "./leakage";
import { splitDatasetCases } from "./split";
import type {
  EvolutionDatasetBuildInput,
  EvolutionDatasetDigestInput,
  EvolutionDatasetSplit,
} from "./types";

const PUBLIC_RANK = 0;
const INTERNAL_RANK = 1;
const CONFIDENTIAL_RANK = 2;
const RESTRICTED_RANK = 3;

const classificationRank = new Map([
  ["public", PUBLIC_RANK],
  ["internal", INTERNAL_RANK],
  ["confidential", CONFIDENTIAL_RANK],
  ["restricted", RESTRICTED_RANK],
]);

const maximumClassification = (
  input: Pick<EvolutionDatasetBuildInput, "sources" | "cases">,
): typeof EvolutionClassificationSchema.Type =>
  [...input.sources, ...input.cases].reduce<
    typeof EvolutionClassificationSchema.Type
  >(
    (highest, item) =>
      (classificationRank.get(item.classification) ?? 0)
          > (classificationRank.get(highest) ?? 0)
        ? item.classification
        : highest,
    "public",
  );

const digestCases = (
  cases: readonly { readonly id: string; readonly split: string; }[],
  split: EvolutionDatasetSplit,
): string =>
  `sha256:${
    createHash("sha256")
      .update(JSON.stringify(cases.filter((item) => item.split === split)))
      .digest("hex")
  }`;

const datasetDigest = (
  input: EvolutionDatasetDigestInput,
): string =>
  `sha256:${
    createHash("sha256")
      .update(JSON.stringify({
        targetDigest: input.targetDigest,
        splitSeed: input.splitSeed,
        splitDigests: input.splitDigests,
        sources: input.sources,
      }))
      .digest("hex")
  }`;

export const validateEvolutionDatasetManifest = Effect.fn(
  "validateEvolutionDatasetManifest",
)(function*(dataset: EvolutionDatasetManifest) {
  yield* validateDatasetLeakage(dataset.cases);
  const splitDigests = {
    train: digestCases(dataset.cases, "train"),
    validation: digestCases(dataset.cases, "validation"),
    holdout: digestCases(dataset.cases, "holdout"),
  };
  const digest = datasetDigest({
    targetDigest: dataset.targetDigest,
    splitSeed: dataset.splitSeed,
    splitDigests,
    sources: dataset.sources,
  });
  const valid = JSON.stringify(splitDigests)
      === JSON.stringify(dataset.splitDigests)
    && digest === dataset.digest
    && dataset.holdoutSealed
    && maximumClassification(dataset) === dataset.classification;
  if (!valid) {
    return yield* EvolutionDatasetError.make({
      operation: "validate-manifest-integrity",
      reason: "dataset digest, classification, or holdout seal is invalid",
      caseIds: dataset.cases.map((item) => item.id),
    });
  }
});

export const buildEvolutionDataset = Effect.fn("buildEvolutionDataset")(
  function*(input: EvolutionDatasetBuildInput) {
    const cases = splitDatasetCases(input.cases, input.splitSeed, input.split);
    yield* validateDatasetLeakage(cases);
    const splitDigests = {
      train: digestCases(cases, "train"),
      validation: digestCases(cases, "validation"),
      holdout: digestCases(cases, "holdout"),
    };
    const digest = datasetDigest({
      targetDigest: input.targetDigest,
      splitSeed: input.splitSeed,
      splitDigests,
      sources: input.sources,
    });
    return EvolutionDatasetManifest.make({
      id: input.id,
      targetDigest: input.targetDigest,
      digest,
      splitSeed: input.splitSeed,
      splitDigests,
      classification: maximumClassification(input),
      sources: input.sources,
      cases,
      createdAt: input.createdAt,
      sealedAt: input.createdAt,
      holdoutSealed: true,
    });
  },
);
