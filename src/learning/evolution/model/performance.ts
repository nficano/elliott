import * as Schema from "effect/Schema";
import { EvolutionTargetClassSchema } from "./identifiers";

export class EvolutionPerformanceProjection
  extends Schema.Class<EvolutionPerformanceProjection>(
    "EvolutionPerformanceProjection",
  )({
    targetRef: Schema.String,
    targetClass: EvolutionTargetClassSchema,
    targetDigest: Schema.String,
    successRate: Schema.Number,
    correctionRate: Schema.Number,
    benchmarkScore: Schema.Number,
    averageCostUsd: Schema.Number,
    sampleCount: Schema.Int,
    projectedAt: Schema.String,
  })
{}
