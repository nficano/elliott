import type {
  EvolutionCaseResult,
  EvolutionComparisonRequest,
} from "../../../../src/learning/evolution/model/index";
import { wireError } from "../../../runtime/wire";

export const totalCost = (results: readonly EvolutionCaseResult[]): number =>
  results.reduce((total, result) => total + result.costUsd, 0);

export const totalLatency = (
  results: readonly EvolutionCaseResult[],
): number =>
  results.reduce((total, result) => total + result.latencyMilliseconds, 0);

export const averageMetric = (
  results: readonly EvolutionCaseResult[],
  metric: string,
  split: EvolutionCaseResult["split"],
): number => {
  const values = results.flatMap((result) =>
    result.split === split && result.metricValues[metric] !== undefined
      ? [result.metricValues[metric]]
      : []
  );
  return values.length === 0
    ? wireError(`metric ${metric} has no ${split} samples`)
    : values.reduce((total, value) => total + value, 0) / values.length;
};

export const holdoutSamples = (
  request: EvolutionComparisonRequest,
  results: readonly EvolutionCaseResult[],
): readonly number[] => {
  const primary = request.metrics[0];
  if (primary === undefined) return wireError("primary metric is required");
  return results
    .filter((item) => item.split === "holdout")
    .map((item) => item.metricValues[primary.name])
    .map((item) => {
      if (item === undefined) {
        return wireError(`metric ${primary.name} is missing`);
      }
      return primary.direction === "maximize" ? item : -item;
    });
};

export const regressionRatio = (
  baseline: number,
  candidate: number,
): number => {
  if (baseline !== 0) return (candidate - baseline) / baseline;
  return candidate === 0 ? 0 : Number.MAX_VALUE;
};
