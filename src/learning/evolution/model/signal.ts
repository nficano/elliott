import * as Schema from "effect/Schema";
import {
  EvolutionRiskClassSchema,
  EvolutionTargetClassSchema,
} from "./identifiers";

export class EvolutionSignal extends Schema.Class<EvolutionSignal>(
  "EvolutionSignal",
)({
  id: Schema.String,
  targetRef: Schema.String,
  targetClass: EvolutionTargetClassSchema,
  riskClass: EvolutionRiskClassSchema,
  strength: Schema.Number,
  usageFrequency: Schema.Number,
  expectedImpact: Schema.Number,
  evaluatorConfidence: Schema.Number,
  estimatedCost: Schema.Number,
  source: Schema.Literals([
    "explicit-feedback",
    "deterministic-failure",
    "workaround",
    "tool-failure",
    "model-reflection",
    "benchmark",
  ]),
  createdAt: Schema.String,
}) {}
