import type { EvolutionBaselineReport } from "../../../../src/learning/evolution/model/index";
import { makeBaselineReport } from "./baseline";
import { executeEvaluationCases } from "./executor";
import { validateBaselineRequest } from "./validation";

export { compare } from "./compare";

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
