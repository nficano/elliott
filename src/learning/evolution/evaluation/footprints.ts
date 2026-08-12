import { evaluateFootprintBudget } from "../../../observability/index";
import { EvolutionFootprintResult } from "../model/index";
import type { EvolutionFootprintBudget } from "./types";

export const evaluateEvolutionFootprint = (
  budget: EvolutionFootprintBudget,
): EvolutionFootprintResult => {
  const result = evaluateFootprintBudget(budget);
  return EvolutionFootprintResult.make({
    category: budget.category,
    metric: budget.metric,
    baseline: budget.baseline,
    candidate: budget.current,
    maximumRegressionRatio: budget.maximumRegressionRatio,
    regressionRatio: result.regressionRatio,
    status: result.passed ? "passed" : "failed",
    passed: result.passed,
  });
};

export const notApplicableEvolutionFootprint = (
  category: EvolutionFootprintBudget["category"],
  reason: string,
): EvolutionFootprintResult =>
  EvolutionFootprintResult.make({
    category,
    metric: `${category}-not-applicable`,
    baseline: 0,
    candidate: 0,
    maximumRegressionRatio: 0,
    regressionRatio: 0,
    status: "not-applicable",
    reason,
    passed: true,
  });
