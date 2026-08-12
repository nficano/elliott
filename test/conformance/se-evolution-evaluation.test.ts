import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  buildEvolutionDataset,
  evaluateEvolutionFootprint,
  pairedBootstrapComparison,
  validateCandidateConstraints,
  validateEngineIsolation,
} from "../../src/learning/evolution/index";
import {
  EvolutionDatasetIdSchema,
  EvolutionUnsplitDatasetCase,
} from "../../src/learning/evolution/model/index";
import { makeCandidate } from "../unit/evolution/helpers";

const datasetCases = () =>
  Array.from({ length: 10 }, (_, index) =>
    EvolutionUnsplitDatasetCase.make({
      id: `case-${index}`,
      groupId: `group-${index}`,
      input: { index },
      expected: { correct: true },
      classification: "internal",
      sourceDigests: ["sha256:source"],
      timeoutMilliseconds: 1000,
      maximumCostUsd: 0,
      allowedEffects: [],
    }));

describe("SE evaluation conformance", () => {
  it("SE6 reproduces sealed dataset bytes from stored inputs and seed", async () => {
    const input = {
      id: EvolutionDatasetIdSchema.make("evd_12345678"),
      targetDigest: "sha256:target",
      sources: [],
      cases: datasetCases(),
      splitSeed: 42,
      split: { train: 0.6, validation: 0.2, holdout: 0.2 },
      createdAt: new Date(0).toISOString(),
    };
    const first = await Effect.runPromise(buildEvolutionDataset(input));
    const second = await Effect.runPromise(buildEvolutionDataset(input));
    expect(second).toEqual(first);
    expect(first.holdoutSealed).toBe(true);
    expect(first.splitDigests.holdout).toStartWith("sha256:");
  });

  it("SE7 fails closed when a required constraint is absent", async () => {
    await Effect.runPromise(validateCandidateConstraints({
      targetRef: "workspace/skill/review",
      candidate: makeCandidate(),
      requiredConstraints: ["syntax"],
    }));
    await expect(Effect.runPromise(validateCandidateConstraints({
      targetRef: "workspace/skill/review",
      candidate: makeCandidate(),
      requiredConstraints: ["syntax", "permission-containment"],
    }))).rejects.toHaveProperty("_tag", "EvolutionConstraintError");
  });

  it("SE8 reports paired effect, interval, sample count, and correction", async () => {
    const comparison = await Effect.runPromise(pairedBootstrapComparison({
      baseline: [0, 0, 0, 0],
      candidate: [1, 1, 1, 1],
      confidenceLevel: 0.95,
      iterations: 100,
      seed: 7,
      regressionFloor: 0,
      multipleComparisonCount: 4,
    }));
    expect(comparison.effectSize).toBe(1);
    expect(comparison.confidenceIntervalLow).toBe(1);
    expect(comparison.sampleCount).toBe(4);
    expect(comparison.multipleComparisonCorrection).toBe("bonferroni");
  });

  it("SE9 enforces prompt, inference, and runtime footprint budgets", () => {
    const categories = ["prompt", "inference", "runtime"] as const;
    const results = categories.map((category) =>
      evaluateEvolutionFootprint({
        category,
        metric: `${category}-budget`,
        baseline: 100,
        current: category === "runtime" ? 121 : 100,
        maximumRegressionRatio: 0.2,
      })
    );
    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
      "failed",
    ]);
  });

  it("SE10 requires a digest-pinned isolated engine schema boundary", async () => {
    await Effect.runPromise(validateEngineIsolation({
      engineRef: "organization/evaluator/dspy",
      isolation: "remote",
      image: `engine@sha256:${"a".repeat(64)}`,
      hasRepositoryCredentials: false,
      hasActiveTreeWrite: false,
      hasContainerRuntimeSocket: false,
      holdoutReadable: false,
    }));
    await expect(Effect.runPromise(validateEngineIsolation({
      engineRef: "organization/evaluator/dspy",
      isolation: "in-process",
      image: "engine:latest",
      hasRepositoryCredentials: true,
      hasActiveTreeWrite: true,
      hasContainerRuntimeSocket: true,
      holdoutReadable: true,
    }))).rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });
});
