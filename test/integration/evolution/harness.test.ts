import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { EvolutionDatasetSplit } from "../../../src/learning/evolution/datasets/types";
import { makeEvaluationHarness } from "../../../src/learning/evolution/evaluation/harness";
import {
  EvolutionCaseResult,
  EvolutionDatasetCase,
  EvolutionDatasetIdSchema,
  EvolutionDatasetManifest,
  EvolutionFootprintResult,
  EvolutionMetricDefinition,
  EvolutionRun,
  ShortlistedRunState,
} from "../../../src/learning/evolution/model/index";
import { makeCandidate, makeRun } from "../../unit/evolution/helpers";

const evaluationDataset = () => {
  const splits: readonly EvolutionDatasetSplit[] = [
    "train",
    "validation",
    "holdout",
  ];
  const cases = splits.map((split) =>
    EvolutionDatasetCase.make({
      id: `case-${split}`,
      groupId: `group-${split}`,
      split,
      input: { task: split },
      expected: { correct: true },
      classification: "internal",
      sourceDigests: ["sha256:source"],
      timeoutMilliseconds: 1000,
      maximumCostUsd: 0.1,
      allowedEffects: [],
    })
  );
  return EvolutionDatasetManifest.make({
    id: EvolutionDatasetIdSchema.make("evd_12345678"),
    targetDigest: "sha256:baseline",
    digest: "sha256:dataset",
    splitSeed: 1,
    splitDigests: {
      train: "sha256:train",
      validation: "sha256:validation",
      holdout: "sha256:holdout",
    },
    classification: "internal",
    sources: [],
    cases,
    createdAt: new Date(0).toISOString(),
    sealedAt: new Date(0).toISOString(),
    holdoutSealed: true,
  });
};

describe("snapshot-bound evolution evaluation", () => {
  it("SE2 binds every paired case to one immutable Snapshot", async () => {
    const candidate = makeCandidate();
    const baseRun = makeRun();
    const dataset = evaluationDataset();
    const run = EvolutionRun.make({
      ...baseRun,
      datasetId: dataset.id,
      datasetDigest: dataset.digest,
      state: ShortlistedRunState.make({
        candidateIds: [candidate.id],
        sealedAt: new Date(0).toISOString(),
      }),
    });
    const harness = makeEvaluationHarness({
      execute: (snapshotId, evaluationCase) =>
        Effect.succeed(EvolutionCaseResult.make({
          caseId: evaluationCase.id,
          split: evaluationCase.split,
          snapshotId,
          metricValues: {
            correctness: snapshotId === "snapshot:candidate" ? 0.8 : 0.5,
          },
          costUsd: 0,
          latencyMilliseconds: 1,
          passed: true,
        })),
    });
    const report = await Effect.runPromise(harness.evaluate({
      run,
      candidate,
      dataset,
      baselineSnapshotId: "snapshot:baseline",
      candidateSnapshotId: "snapshot:candidate",
      evaluatorRef: "organization/evaluator/independent",
      authoringRouteDigest: "sha256:author",
      evaluationRouteDigest: "sha256:judge",
      evaluationPlanDigest: "sha256:plan",
      environmentDigest: "sha256:environment",
      seed: 1,
      metrics: [
        EvolutionMetricDefinition.make({
          name: "correctness",
          direction: "maximize",
          weight: 1,
          regressionFloor: 0,
        }),
      ],
      confidenceLevel: 0.95,
      bootstrapIterations: 100,
      multipleComparisonCount: 1,
      requiredConstraints: ["syntax"],
      benchmarkStages: [{
        benchmarkRef: "yc-bench",
        applicable: false,
        notApplicableReason: "skill campaign fixture",
        run: () => Effect.die("not applicable stage ran"),
      }],
      footprints: [
        EvolutionFootprintResult.make({
          category: "prompt",
          metric: "prompt-tokens",
          baseline: 10,
          candidate: 10,
          maximumRegressionRatio: 0,
          regressionRatio: 0,
          status: "passed",
          passed: true,
        }),
        EvolutionFootprintResult.make({
          category: "inference",
          metric: "input-tokens",
          baseline: 10,
          candidate: 10,
          maximumRegressionRatio: 0,
          regressionRatio: 0,
          status: "passed",
          passed: true,
        }),
        EvolutionFootprintResult.make({
          category: "runtime",
          metric: "memory-mb",
          baseline: 10,
          candidate: 10,
          maximumRegressionRatio: 0,
          regressionRatio: 0,
          status: "passed",
          passed: true,
        }),
      ],
    }));
    expect(report.passed).toBe(true);
    expect(report.benchmarks).toHaveLength(1);
    expect(report.benchmarks[0]?.status).toBe("not-applicable");
    expect(report.comparison.effectSize).toBeCloseTo(0.3);
    expect(report.baselineCases.every(
      (item) => item.snapshotId === "snapshot:baseline",
    )).toBe(true);
  });
});
