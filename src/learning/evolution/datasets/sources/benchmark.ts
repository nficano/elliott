import {
  EvolutionDatasetSource,
  EvolutionUnsplitDatasetCase,
} from "../../model/index";
import type {
  EvolutionBenchmarkSourceInput,
  EvolutionDatasetSourceResult,
} from "./types";

const DEFAULT_TIMEOUT_MILLISECONDS = 120_000;

export const benchmarkDerivedDatasetSource = (
  input: EvolutionBenchmarkSourceInput,
): EvolutionDatasetSourceResult => ({
  source: EvolutionDatasetSource.make({
    kind: "benchmark",
    reference: input.benchmarkRef,
    digest: input.sourceDigest,
    classification: input.classification,
    consentOrLicense: "benchmark-license-applies",
  }),
  cases: input.taskIds.map((taskId) =>
    EvolutionUnsplitDatasetCase.make({
      id: `benchmark-${taskId}`,
      groupId: `benchmark-${taskId}`,
      input: { benchmarkRef: input.benchmarkRef, taskId },
      expected: {
        rubric:
          "Improve the task-specific behavior without private expected output.",
      },
      rubric: "The independent benchmark adapter retains the private oracle.",
      classification: input.classification,
      sourceDigests: [input.sourceDigest],
      timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
      maximumCostUsd: 0,
      allowedEffects: [],
    })
  ),
});
