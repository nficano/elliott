import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  makeEvolutionOperatorExecutor,
} from "../../../src/learning/evolution/application/index";
import type {
  EvolutionOperatorApplicationInput,
} from "../../../src/learning/evolution/application/types";
import { EvolutionConfig } from "../../../src/learning/evolution/config";
import {
  DatasetReadyRunState,
  EvolutionComparisonRequest,
  EvolutionRun,
  ScopedRunState,
} from "../../../src/learning/evolution/model/index";

const comparisonRequest = async () =>
  Schema.decodeUnknownSync(EvolutionComparisonRequest)(
    await Bun.file(
      new URL(
        "../../../companions/fixtures/evaluation-request.json",
        import.meta.url,
      ),
    ).json(),
  );

const config = EvolutionConfig.make({
  apiVersion: "elliott/v1",
  engines: {
    text: { primary: "organization/evaluator/dspy-gepa" },
    code: { primary: "organization/evaluator/darwinian" },
  },
  budgets: {
    perRun: {
      candidates: 2,
      tokens: 100,
      costUsd: 1,
      durationMinutes: 1,
    },
    monthly: { costUsd: 10 },
  },
  evaluation: {
    authoringProfile: "author",
    judgingProfile: "judge",
    requireDistinctRoute: true,
    split: { train: 0.6, validation: 0.2, holdout: 0.2 },
  },
  continuous: {
    enabled: false,
    benchmarkCron: "0 3 * * 0",
    maximumRiskClass: "C2",
    maximumConcurrentRuns: 1,
  },
  targets: {
    allow: ["workspace/skill/*"],
    deny: [],
  },
});

describe("evolution application baseline ordering", () => {
  it("awaits a sealed baseline evaluation before invoking optimization", async () => {
    const comparison = await comparisonRequest();
    const stages: string[] = [];
    const scoped = EvolutionRun.make({
      id: comparison.run.id,
      principalId: comparison.run.principalId,
      baselineSnapshotId: comparison.run.baselineSnapshotId,
      engineRef: comparison.run.engineRef,
      engineKind: comparison.run.engineKind,
      configurationDigest: comparison.run.configurationDigest,
      signalIds: comparison.run.signalIds,
      target: comparison.run.target,
      budgets: comparison.run.budgets,
      state: ScopedRunState.make({ scopedAt: new Date(0).toISOString() }),
      createdAt: comparison.run.createdAt,
      updatedAt: comparison.run.updatedAt,
    });
    const datasetReady = EvolutionRun.make({
      ...scoped,
      datasetId: comparison.dataset.id,
      datasetDigest: comparison.dataset.digest,
      state: DatasetReadyRunState.make({
        datasetId: comparison.dataset.id,
        datasetDigest: comparison.dataset.digest,
      }),
    });
    const input = {
      config,
      configurationDigest: "sha256:configuration",
      orchestrator: {
        scope: () =>
          Effect.sync(() => {
            stages.push("scope");
            return scoped;
          }),
        attachDataset: () =>
          Effect.sync(() => {
            stages.push("dataset");
            return datasetReady;
          }),
        optimize: () =>
          Effect.sync(() => {
            stages.push("optimize");
            return [];
          }),
      },
      runs: {
        get: () => Effect.succeed(datasetReady),
      },
      candidates: {},
      datasets: {},
      reports: {},
      releases: {},
      proposalStore: {},
      targets: {
        resolve: () =>
          Effect.succeed({
            target: comparison.run.target,
            baselineContent: "baseline",
          }),
      },
      datasetFactory: {
        build: () => Effect.succeed(comparison.dataset),
      },
      evaluationRequestFactory: {},
      evaluator: {},
      baselineController: {
        measure: ({ run }: { readonly run: EvolutionRun; }) =>
          Effect.sync(() => {
            expect(run.state._tag).toBe("dataset-ready");
            stages.push("baseline");
            return {} as never;
          }),
      },
      releaseController: {},
      now: () => new Date(0).toISOString(),
      randomSeed: () => 7,
    } as unknown as EvolutionOperatorApplicationInput;
    const executor = makeEvolutionOperatorExecutor(input);
    await executor.execute(
      {
        principalId: "operator",
        snapshotId: "snapshot-baseline",
        authorize: async () => true,
      },
      {
        operation: "evolution.run",
        arguments: [comparison.run.target.componentRef],
      },
    );
    expect(stages).toEqual(["scope", "dataset", "baseline", "optimize"]);
  });
});
