import path from "node:path";
import { EvolutionConstraintResult } from "../model/index";
import type {
  EvolutionPathConstraintInput,
  EvolutionTargetValidation,
} from "../targets/types";

export const constraintResult = (
  constraint: string,
  passed: boolean,
  detail: string,
): EvolutionConstraintResult =>
  EvolutionConstraintResult.make({
    constraint,
    passed,
    detail,
    evidenceDigests: [],
  });

const pathMatches = (candidate: string, allowed: string): boolean => {
  const relative = path.relative(
    path.resolve(allowed),
    path.resolve(candidate),
  );
  return relative.length === 0
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const validateMutationPaths = (
  input: EvolutionPathConstraintInput,
): readonly EvolutionConstraintResult[] => {
  const contained = input.changedPaths.every((changedPath) =>
    input.target.allowedMutationPaths.some((allowedPath) =>
      pathMatches(changedPath, allowedPath)
    )
  );
  const frozen = input.changedPaths.every((changedPath) =>
    input.target.frozenPaths.every((frozenPath) =>
      !pathMatches(changedPath, frozenPath)
    )
  );
  return [
    constraintResult(
      "path-containment",
      contained,
      contained
        ? "all changed paths are within the authorized mutation surface"
        : "one or more changed paths escape the authorized mutation surface",
    ),
    constraintResult(
      "frozen-paths",
      frozen,
      frozen
        ? "no frozen path changed"
        : "a frozen path changed",
    ),
  ];
};

export const validation = (
  results: readonly EvolutionConstraintResult[],
): EvolutionTargetValidation => ({
  results,
  passed: results.length > 0 && results.every((result) => result.passed),
});
