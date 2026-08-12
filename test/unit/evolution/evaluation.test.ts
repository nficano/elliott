import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { EvolutionDatasetBuildInput } from "../../../src/learning/evolution/datasets/types";
import {
  buildEvolutionDataset,
  pairedBootstrapComparison,
  validateDatasetLeakage,
} from "../../../src/learning/evolution/index";
import {
  EvolutionDatasetCase,
  EvolutionDatasetIdSchema,
  EvolutionDatasetSource,
} from "../../../src/learning/evolution/model/index";

const CASE_COUNT = 60;
const BOOTSTRAP_ITERATIONS = 500;

const buildInput = (): EvolutionDatasetBuildInput => ({
  id: EvolutionDatasetIdSchema.make("evd_12345678"),
  targetDigest: "sha256:target",
  splitSeed: 42,
  split: { train: 0.6, validation: 0.2, holdout: 0.2 },
  sources: [
    EvolutionDatasetSource.make({
      kind: "golden",
      reference: "evals/review.jsonl",
      digest: "sha256:source",
      classification: "internal",
      consentOrLicense: "workspace-owned",
    }),
  ],
  cases: Array.from({ length: CASE_COUNT }, (_, index) => ({
    id: `case-${index}`,
    groupId: `group-${index}`,
    input: { prompt: `review ${index}` },
    expected: { accepted: true },
    classification: "internal",
    sourceDigests: ["sha256:source"],
    timeoutMilliseconds: 1000,
    maximumCostUsd: 0.1,
    allowedEffects: [],
  })),
  createdAt: new Date(0).toISOString(),
});

describe("evolution datasets and statistics", () => {
  it("seals deterministic grouped splits with classified holdout digests", async () => {
    const first = await Effect.runPromise(buildEvolutionDataset(buildInput()));
    const second = await Effect.runPromise(buildEvolutionDataset(buildInput()));
    expect(first).toEqual(second);
    expect(first.holdoutSealed).toBe(true);
    expect(first.classification).toBe("internal");
    expect(new Set(first.cases.map((item) => item.split)).size).toBe(3);
    expect(first.splitDigests.holdout).toStartWith("sha256:");
  });

  it("fails closed when equivalent inputs cross splits", async () => {
    const cases = [
      EvolutionDatasetCase.make({
        id: "one",
        groupId: "group",
        input: { prompt: "same" },
        expected: { accepted: true },
        classification: "internal",
        sourceDigests: ["sha256:source"],
        timeoutMilliseconds: 1000,
        maximumCostUsd: 0.1,
        allowedEffects: [],
        split: "train",
      }),
      EvolutionDatasetCase.make({
        id: "two",
        groupId: "other",
        input: { prompt: "same" },
        expected: { accepted: true },
        classification: "internal",
        sourceDigests: ["sha256:source"],
        timeoutMilliseconds: 1000,
        maximumCostUsd: 0.1,
        allowedEffects: [],
        split: "holdout",
      }),
    ];
    await expect(
      Effect.runPromise(validateDatasetLeakage(cases)),
    ).rejects.toHaveProperty("_tag", "EvolutionDatasetError");
  });

  it("reports paired effect size, interval, and correction", async () => {
    const baseline = Array.from({ length: CASE_COUNT }, () => 0.5);
    const candidate = Array.from({ length: CASE_COUNT }, () => 0.7);
    const result = await Effect.runPromise(pairedBootstrapComparison({
      baseline,
      candidate,
      confidenceLevel: 0.95,
      iterations: BOOTSTRAP_ITERATIONS,
      seed: 7,
      regressionFloor: 0,
      multipleComparisonCount: 2,
    }));
    expect(result.effectSize).toBeCloseTo(0.2);
    expect(result.confidenceIntervalLow).toBeGreaterThan(0);
    expect(result.multipleComparisonCorrection).toBe("bonferroni");
    expect(result.passed).toBe(true);
  });
});
