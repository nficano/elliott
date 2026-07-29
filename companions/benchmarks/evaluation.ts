import type { EvolutionBaselineReport } from "../../src/learning/evolution/model/index";
import { makeBaselineReport } from "./evaluation-baseline";
import { executeEvaluationCases } from "./evaluation-executor";
import { validateBaselineRequest } from "./evaluation-validation";

export { compare } from "./evaluation-compare";

export const baseline = async (
  value: unknown,
): Promise<EvolutionBaselineReport> => {
  const request = validateBaselineRequest(value);
  const cases = request.dataset.cases.filter(
    (item) => item.split === "validation" || item.split === "holdout",
  );
  const results = await executeEvaluationCases(
    request,
    cases,
    request.baselineSnapshotId,
  );
  return makeBaselineReport(request, results);
};
