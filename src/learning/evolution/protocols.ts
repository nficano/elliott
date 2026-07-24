import * as Schema from "effect/Schema";
import { protocolId } from "../../core/brands";
import type { ProtocolDescriptor } from "../../core/types";
import {
  EvolutionAuthorityError,
  EvolutionBudgetError,
  EvolutionConstraintError,
  EvolutionDatasetError,
  EvolutionEngineError,
  EvolutionEvaluationError,
  EvolutionPromotionError,
  EvolutionStaleTargetError,
} from "./errors";
import {
  EvolutionBenchmarkOperation,
  EvolutionDatasetOperation,
  EvolutionEvaluationOperation,
  EvolutionEvaluationReport,
  EvolutionReleaseProjectionOperation,
  EvolutionTargetOperation,
  OptimizationEngineRequest,
  OptimizationEngineResult,
} from "./model/index";

const descriptor = (
  id: string,
  input: unknown,
  schemaMetadata: Readonly<Record<string, unknown>>,
): ProtocolDescriptor =>
  Object.freeze({
    id: protocolId(id),
    schema: Object.freeze({ input, ...schemaMetadata }),
  });

const protocolMetadata = (
  output: unknown,
  capabilities: readonly string[],
  auditRecords: readonly string[],
) => ({
  output,
  errors: Schema.toJsonSchemaDocument(Schema.Union([
    EvolutionAuthorityError,
    EvolutionBudgetError,
    EvolutionConstraintError,
    EvolutionDatasetError,
    EvolutionEngineError,
    EvolutionEvaluationError,
    EvolutionPromotionError,
    EvolutionStaleTargetError,
  ])),
  capabilities,
  limits: {
    required: true,
    algebra: "minimum-across-all-scopes",
  },
  audit: {
    recordTypes: auditRecords,
    digestsOnly: true,
    secretsAllowed: false,
  },
});

const targetSchema = Schema.toJsonSchemaDocument(EvolutionTargetOperation);
const datasetSchema = Schema.toJsonSchemaDocument(EvolutionDatasetOperation);
const optimizationInputSchema = Schema.toJsonSchemaDocument(
  OptimizationEngineRequest,
);
const optimizationOutputSchema = Schema.toJsonSchemaDocument(
  OptimizationEngineResult,
);
const evaluationSchema = Schema.toJsonSchemaDocument(
  EvolutionEvaluationOperation,
);
const evaluationOutputSchema = Schema.toJsonSchemaDocument(
  EvolutionEvaluationReport,
);
const benchmarkSchema = Schema.toJsonSchemaDocument(
  EvolutionBenchmarkOperation,
);
const projectionSchema = Schema.toJsonSchemaDocument(
  EvolutionReleaseProjectionOperation,
);

export const EVOLUTION_TARGET_PROTOCOL = descriptor(
  "evolution.target",
  targetSchema,
  protocolMetadata(
    targetSchema,
    ["evolution.target.read", "evolution.candidate.write"],
    ["evolution.run.scoped", "evolution.candidate.created"],
  ),
);

export const EVALUATION_DATASET_PROTOCOL = descriptor(
  "evaluation.dataset",
  datasetSchema,
  protocolMetadata(
    datasetSchema,
    ["evolution.dataset.read"],
    ["evolution.dataset.sealed"],
  ),
);

export const OPTIMIZATION_ENGINE_PROTOCOL = descriptor(
  "optimization.engine",
  optimizationInputSchema,
  protocolMetadata(
    optimizationOutputSchema,
    ["evolution.engine.invoke", "evolution.candidate.write"],
    ["evolution.engine.started", "evolution.candidate.created"],
  ),
);

export const EVALUATION_RUNNER_PROTOCOL = descriptor(
  "evaluation.runner",
  evaluationSchema,
  protocolMetadata(
    evaluationOutputSchema,
    ["evaluation.run", "evolution.dataset.read"],
    ["evolution.evaluation.completed"],
  ),
);

export const BENCHMARK_RUNNER_PROTOCOL = descriptor(
  "benchmark.runner",
  benchmarkSchema,
  protocolMetadata(
    benchmarkSchema,
    ["evaluation.run"],
    ["evolution.evaluation.completed"],
  ),
);

export const RELEASE_PROJECTION_PROTOCOL = descriptor(
  "release.projection",
  projectionSchema,
  protocolMetadata(
    projectionSchema,
    ["release.project.git"],
    ["evolution.git.published"],
  ),
);

export const EVOLUTION_PROTOCOLS: readonly ProtocolDescriptor[] = Object.freeze(
  [
    EVOLUTION_TARGET_PROTOCOL,
    EVALUATION_DATASET_PROTOCOL,
    OPTIMIZATION_ENGINE_PROTOCOL,
    EVALUATION_RUNNER_PROTOCOL,
    BENCHMARK_RUNNER_PROTOCOL,
    RELEASE_PROJECTION_PROTOCOL,
  ],
);
