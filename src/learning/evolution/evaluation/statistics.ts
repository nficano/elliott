import * as Effect from "effect/Effect";
import { EvolutionEvaluationError } from "../errors";
import { EvolutionStatisticalComparison } from "../model/index";
import type { EvolutionStatisticsInput } from "./types";

const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const LCG_MODULUS = 0x1_00_00_00_00;

const randomSequence = (seed: number): () => number => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / LCG_MODULUS;
  };
};

const mean = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const quantile = (values: readonly number[], probability: number): number => {
  const ordered = values.toSorted((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(ordered.length - 1, Math.floor(probability * ordered.length)),
  );
  return ordered[index] ?? NaN;
};

export const pairedBootstrapComparison = Effect.fn(
  "pairedBootstrapComparison",
)(function*(input: EvolutionStatisticsInput) {
  if (
    input.baseline.length === 0
    || input.baseline.length !== input.candidate.length
    || input.iterations <= 0
    || input.confidenceLevel <= 0
    || input.confidenceLevel >= 1
  ) {
    return yield* EvolutionEvaluationError.make({
      evaluatorRef: "elliott/statistics/paired-bootstrap",
      operation: "compare",
      cause:
        "paired non-empty samples, iterations, and confidence are required",
    });
  }
  const deltas = input.candidate.map(
    (value, index) => value - (input.baseline[index] ?? 0),
  );
  const random = randomSequence(input.seed);
  const samples = Array.from({ length: input.iterations }, () => {
    const resample = Array.from(
      { length: deltas.length },
      () => deltas[Math.floor(random() * deltas.length)] ?? 0,
    );
    return mean(resample);
  });
  const adjustedAlpha = (1 - input.confidenceLevel)
    / Math.max(1, input.multipleComparisonCount);
  const low = quantile(samples, adjustedAlpha / 2);
  const high = quantile(samples, 1 - adjustedAlpha / 2);
  const nonPositive = samples.filter((sample) => sample <= 0).length;
  return EvolutionStatisticalComparison.make({
    method: "paired-bootstrap",
    effectSize: mean(deltas),
    confidenceLevel: input.confidenceLevel,
    confidenceIntervalLow: low,
    confidenceIntervalHigh: high,
    pValue: nonPositive / samples.length,
    sampleCount: deltas.length,
    multipleComparisonCorrection: input.multipleComparisonCount > 1
      ? "bonferroni"
      : "none",
    passed: low >= input.regressionFloor,
  });
});
