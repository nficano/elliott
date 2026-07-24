import type { EvolutionDatasetSplit } from "../datasets/types";
import {
  type EvolutionMetricDefinition,
  EvolutionMetricResult,
} from "../model/index";
import type { EvolutionFitnessInput, EvolutionFitnessResult } from "./types";

const SPLITS: readonly EvolutionDatasetSplit[] = [
  "train",
  "validation",
  "holdout",
];

const averageMetric = (
  metric: string,
  split: EvolutionDatasetSplit,
  cases: EvolutionFitnessInput["baseline"],
): number => {
  const values = cases
    .filter((result) => result.split === split)
    .flatMap((result) => {
      const value = result.metricValues[metric];
      return value === undefined ? [] : [value];
    });
  return values.length === 0
    ? NaN
    : values.reduce((total, value) => total + value, 0) / values.length;
};

const metricResult = (
  definition: EvolutionMetricDefinition,
  split: EvolutionDatasetSplit,
  input: EvolutionFitnessInput,
): EvolutionMetricResult => {
  const baseline = averageMetric(definition.name, split, input.baseline);
  const candidate = averageMetric(definition.name, split, input.candidate);
  const delta = candidate - baseline;
  const directionalDelta = definition.direction === "maximize" ? delta : -delta;
  const sampleCount = input.candidate.filter(
    (result) =>
      result.split === split
      && result.metricValues[definition.name] !== undefined,
  ).length;
  return EvolutionMetricResult.make({
    metric: definition.name,
    split,
    baseline,
    candidate,
    delta,
    sampleCount,
    passed: Number.isFinite(delta)
      && directionalDelta >= definition.regressionFloor,
  });
};

export const calculateFitness = (
  input: EvolutionFitnessInput,
): EvolutionFitnessResult => {
  const metrics = input.definitions.flatMap((definition) =>
    SPLITS.map((split) => metricResult(definition, split, input))
  );
  const holdout = metrics.filter((metric) => metric.split === "holdout");
  const weightedDelta = input.definitions.reduce((total, definition) => {
    const result = holdout.find((metric) => metric.metric === definition.name);
    if (result === undefined) return -Infinity;
    const directionalDelta = definition.direction === "maximize"
      ? result.delta
      : -result.delta;
    return total + directionalDelta * definition.weight;
  }, 0);
  return {
    metrics,
    weightedDelta,
    passed: metrics.every((metric) => metric.passed),
  };
};
