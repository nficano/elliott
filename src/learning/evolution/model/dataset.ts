import * as Schema from "effect/Schema";
import {
  EvolutionClassificationSchema,
  EvolutionDatasetIdSchema,
  EvolutionDatasetSplitSchema,
} from "./identifiers";
import { NonNegativeFiniteSchema, PositiveIntSchema } from "./numeric";
import { EvolutionTarget } from "./run";

export class EvolutionDatasetSource
  extends Schema.Class<EvolutionDatasetSource>("EvolutionDatasetSource")({
    kind: Schema.Literals([
      "synthetic",
      "session",
      "golden",
      "target-specific",
      "benchmark",
    ]),
    reference: Schema.String,
    digest: Schema.String,
    classification: EvolutionClassificationSchema,
    consentOrLicense: Schema.optionalKey(Schema.String),
  })
{}

export class EvolutionDatasetCase
  extends Schema.Class<EvolutionDatasetCase>("EvolutionDatasetCase")({
    id: Schema.String,
    groupId: Schema.String,
    split: EvolutionDatasetSplitSchema,
    input: Schema.Json,
    expected: Schema.Json,
    rubric: Schema.optionalKey(Schema.String),
    classification: EvolutionClassificationSchema,
    sourceDigests: Schema.Array(Schema.String),
    timeoutMilliseconds: PositiveIntSchema,
    maximumCostUsd: NonNegativeFiniteSchema,
    allowedEffects: Schema.Array(Schema.String),
  })
{}

export class EvolutionUnsplitDatasetCase
  extends Schema.Class<EvolutionUnsplitDatasetCase>(
    "EvolutionUnsplitDatasetCase",
  )({
    id: Schema.String,
    groupId: Schema.String,
    input: Schema.Json,
    expected: Schema.Json,
    rubric: Schema.optionalKey(Schema.String),
    classification: EvolutionClassificationSchema,
    sourceDigests: Schema.Array(Schema.String),
    timeoutMilliseconds: PositiveIntSchema,
    maximumCostUsd: NonNegativeFiniteSchema,
    allowedEffects: Schema.Array(Schema.String),
  })
{}

export class EvolutionOptimizerDatasetView
  extends Schema.Class<EvolutionOptimizerDatasetView>(
    "EvolutionOptimizerDatasetView",
  )({
    id: EvolutionDatasetIdSchema,
    targetDigest: Schema.String,
    digest: Schema.String,
    splitSeed: Schema.Int,
    trainDigest: Schema.String,
    validationDigest: Schema.String,
    classification: EvolutionClassificationSchema,
    sources: Schema.Array(EvolutionDatasetSource),
    trainCases: Schema.Array(EvolutionDatasetCase),
    validationCases: Schema.Array(EvolutionDatasetCase),
    holdoutSealed: Schema.Literal(true),
  })
{}

export class EvolutionDatasetManifest
  extends Schema.Class<EvolutionDatasetManifest>(
    "EvolutionDatasetManifest",
  )({
    id: EvolutionDatasetIdSchema,
    targetDigest: Schema.String,
    digest: Schema.String,
    splitSeed: Schema.Int,
    splitDigests: Schema.Struct({
      train: Schema.String,
      validation: Schema.String,
      holdout: Schema.String,
    }),
    classification: EvolutionClassificationSchema,
    sources: Schema.Array(EvolutionDatasetSource),
    cases: Schema.Array(EvolutionDatasetCase),
    createdAt: Schema.String,
    sealedAt: Schema.String,
    holdoutSealed: Schema.Boolean,
  })
{}

export class EvolutionDatasetOperation
  extends Schema.Class<EvolutionDatasetOperation>("EvolutionDatasetOperation")({
    operation: Schema.Literals([
      "build",
      "split",
      "validateLeakage",
      "describe",
    ]),
    target: EvolutionTarget,
    dataset: Schema.optionalKey(EvolutionDatasetManifest),
  })
{}
