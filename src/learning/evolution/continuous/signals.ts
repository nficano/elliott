import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { EvolutionPersistenceError } from "../errors";
import { EvolutionSignal } from "../model/index";
import type {
  EvolutionBenchmarkSignalInput,
  EvolutionFeedbackSignalInput,
  EvolutionSignalDetectionInput,
  EvolutionSignalDetectorShape,
  EvolutionToolFailureSignalInput,
} from "./types";

const CONFIRMED_RESULT_STRENGTH = 0.8;
const TOOL_CONFUSION_STRENGTH = 0.5;
const TOOL_ERROR_CONFIDENCE = 0.9;

export const evolutionSignalFromFeedback = (
  input: EvolutionFeedbackSignalInput,
): EvolutionSignalDetectionInput => ({
  id: input.feedback.id,
  targetRef: input.feedback.targetRef,
  targetClass: input.targetClass,
  riskClass: input.riskClass,
  strength: input.feedback.kind === "explicit-correction"
    ? 1
    : CONFIRMED_RESULT_STRENGTH,
  usageFrequency: input.usageFrequency,
  expectedImpact: input.expectedImpact,
  evaluatorConfidence: 1,
  estimatedCost: input.estimatedCost,
  source: "explicit-feedback",
  evidenceDigest: input.feedback.evidenceDigest,
  classification: input.classification,
  createdAt: input.feedback.createdAt,
});

export const evolutionSignalFromToolFailure = (
  input: EvolutionToolFailureSignalInput,
): EvolutionSignalDetectionInput => ({
  id: input.toolCall.id,
  targetRef: input.targetRef,
  targetClass: "tool-description",
  riskClass: input.riskClass,
  strength: typeof input.toolCall.errorTag === "string"
    ? 1
    : TOOL_CONFUSION_STRENGTH,
  usageFrequency: input.usageFrequency,
  expectedImpact: input.expectedImpact,
  evaluatorConfidence: TOOL_ERROR_CONFIDENCE,
  estimatedCost: input.estimatedCost,
  source: "tool-failure",
  evidenceDigest: input.toolCall.resultDigest ?? input.toolCall.schemaDigest,
  classification: input.classification,
  createdAt: input.toolCall.createdAt,
});

export const evolutionSignalFromBenchmark = (
  input: EvolutionBenchmarkSignalInput,
): EvolutionSignalDetectionInput => ({
  id: input.id,
  targetRef: input.targetRef,
  targetClass: input.targetClass,
  riskClass: input.riskClass,
  strength: Math.max(0, -input.scoreDelta),
  usageFrequency: 1,
  expectedImpact: Math.abs(input.scoreDelta),
  evaluatorConfidence: input.evaluatorConfidence,
  estimatedCost: input.estimatedCost,
  source: "benchmark",
  evidenceDigest: input.evidenceDigest,
  classification: input.classification,
  createdAt: input.createdAt,
});

export const detectEvolutionSignal: EvolutionSignalDetectorShape["detect"] =
  Effect.fn("detectEvolutionSignal")(function*(input, records) {
    const signal = EvolutionSignal.make({
      id: input.id,
      targetRef: input.targetRef,
      targetClass: input.targetClass,
      riskClass: input.riskClass,
      strength: input.strength,
      usageFrequency: input.usageFrequency,
      expectedImpact: input.expectedImpact,
      evaluatorConfidence: input.evaluatorConfidence,
      estimatedCost: input.estimatedCost,
      source: input.source,
      createdAt: input.createdAt,
    });
    yield* Effect.tryPromise({
      try: () =>
        records.append({
          type: "evolution.signal.detected",
          scope: { level: "workspace", id: scopeId(input.targetRef) },
          durability: "observational",
          classification: input.classification,
          payload: {
            signalId: signal.id,
            targetRef: signal.targetRef,
            targetClass: signal.targetClass,
            riskClass: signal.riskClass,
            evidenceDigest: input.evidenceDigest,
          },
        }),
      catch: (cause) =>
        EvolutionPersistenceError.make({
          operation: "append-evolution-signal",
          path: input.targetRef,
          cause,
        }),
    });
    return signal;
  });
