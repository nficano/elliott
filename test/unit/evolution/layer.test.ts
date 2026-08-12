import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unavailableOptimizationEngine } from "../../../src/learning/evolution/engine/http";
import {
  EvolutionPersistenceLive,
  EvolutionRuntimeTest,
} from "../../../src/learning/evolution/layer";
import {
  EvolutionOrchestrator,
  EvolutionRunStore,
} from "../../../src/learning/evolution/services";
import {
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "../../../src/learning/evolution/store/index";
import type { EvolutionExternalServices } from "../../../src/learning/evolution/types";

const stubServices = (): EvolutionExternalServices => ({
  engine: unavailableOptimizationEngine("org/engine", "stub"),
  harness: { evaluate: () => Effect.die("unused") },
  records: { append: async () => undefined } as never,
  proposalStore: { get: () => undefined } as never,
  targetRegistry: { resolve: () => Effect.die("unused") } as never,
  datasetBuilder: { build: () => Effect.die("unused") } as never,
  evaluationRunner: { compare: () => Effect.die("unused") } as never,
  benchmarkRunner: { invoke: () => Effect.die("unused") },
  releaseProjection: { project: () => Effect.die("unused") } as never,
});

describe("evolution layers", () => {
  it("builds EvolutionPersistenceLive over a temp root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evo-layer-"));
    const program = Effect.gen(function*() {
      const runs = yield* EvolutionRunStore;
      return yield* runs.list();
    }).pipe(Effect.provide(EvolutionPersistenceLive(root)));
    expect(await Effect.runPromise(program)).toEqual([]);
  });

  it("builds EvolutionRuntimeTest with stubbed externals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evo-layer-rt-"));
    const stores = {
      runs: makeEvolutionRunStore(root),
      candidates: makeEvolutionCandidateStore(root),
      datasets: makeEvolutionDatasetStore(root),
      reports: makeEvolutionEvaluationReportStore(root),
      releases: makeEvolutionReleaseStore(root),
    };
    const program = Effect.gen(function*() {
      const orchestrator = yield* EvolutionOrchestrator;
      return typeof orchestrator.scope === "function";
    }).pipe(
      Effect.provide(EvolutionRuntimeTest({
        ...stubServices(),
        stores,
      })),
    );
    expect(await Effect.runPromise(program)).toBe(true);
  });
});
