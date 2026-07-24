import * as Layer from "effect/Layer";
import { makeEvolutionConstraintEngine } from "./constraints/engine";
import { makeEvolutionOrchestrator } from "./orchestrator/index";
import { authorEvolutionProposal } from "./release/proposal";
import {
  EvolutionBenchmarkRunner,
  EvolutionCandidateStore,
  EvolutionConstraintEngine,
  EvolutionDatasetBuilder,
  EvolutionDatasetStore,
  EvolutionEvaluationHarness,
  EvolutionEvaluationReportStore,
  EvolutionEvaluationRunner,
  EvolutionOrchestrator,
  EvolutionProposalAuthor,
  EvolutionRecordAppender,
  EvolutionReleaseProjection,
  EvolutionReleaseStore,
  EvolutionRunStore,
  EvolutionTargetRegistry,
  OptimizationEngine,
} from "./services";
import {
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "./store/index";
import type {
  EvolutionExternalServices,
  EvolutionRuntimeLayerInput,
  EvolutionStoreBundle,
  EvolutionTestLayerInput,
} from "./types";

export const EvolutionPersistenceLive = (root: string) =>
  persistenceLayer({
    runs: makeEvolutionRunStore(root),
    candidates: makeEvolutionCandidateStore(root),
    datasets: makeEvolutionDatasetStore(root),
    reports: makeEvolutionEvaluationReportStore(root),
    releases: makeEvolutionReleaseStore(root),
  });

const persistenceLayer = (stores: EvolutionStoreBundle) =>
  Layer.mergeAll(
    Layer.succeed(EvolutionRunStore, stores.runs),
    Layer.succeed(EvolutionCandidateStore, stores.candidates),
    Layer.succeed(EvolutionDatasetStore, stores.datasets),
    Layer.succeed(EvolutionEvaluationReportStore, stores.reports),
    Layer.succeed(EvolutionReleaseStore, stores.releases),
  );

const externalServiceLayer = (services: EvolutionExternalServices) =>
  Layer.mergeAll(
    Layer.succeed(OptimizationEngine, services.engine),
    Layer.succeed(EvolutionEvaluationHarness, services.harness),
    Layer.succeed(EvolutionRecordAppender, services.records),
    Layer.succeed(EvolutionTargetRegistry, services.targetRegistry),
    Layer.succeed(EvolutionDatasetBuilder, services.datasetBuilder),
    Layer.succeed(EvolutionEvaluationRunner, services.evaluationRunner),
    Layer.succeed(EvolutionBenchmarkRunner, services.benchmarkRunner),
    Layer.succeed(EvolutionReleaseProjection, services.releaseProjection),
    Layer.succeed(
      EvolutionProposalAuthor,
      {
        author: (input) =>
          authorEvolutionProposal({
            ...input,
            store: services.proposalStore,
          }),
      },
    ),
    Layer.succeed(
      EvolutionConstraintEngine,
      makeEvolutionConstraintEngine(),
    ),
  );

const completeLayer = (
  services: EvolutionExternalServices,
  stores: EvolutionStoreBundle,
) =>
  Layer.mergeAll(
    persistenceLayer(stores),
    externalServiceLayer(services),
    Layer.succeed(
      EvolutionOrchestrator,
      makeEvolutionOrchestrator({
        runs: stores.runs,
        candidates: stores.candidates,
        datasets: stores.datasets,
        reports: stores.reports,
        engine: services.engine,
        harness: services.harness,
        records: services.records,
      }),
    ),
  );

export const EvolutionRuntimeLive = (input: EvolutionRuntimeLayerInput) =>
  completeLayer(input, {
    runs: makeEvolutionRunStore(input.root),
    candidates: makeEvolutionCandidateStore(input.root),
    datasets: makeEvolutionDatasetStore(input.root),
    reports: makeEvolutionEvaluationReportStore(input.root),
    releases: makeEvolutionReleaseStore(input.root),
  });

export const EvolutionRuntimeTest = (input: EvolutionTestLayerInput) =>
  completeLayer(input, input.stores);
