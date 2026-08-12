import * as Effect from "effect/Effect";
import { EvolutionConstraintError } from "../errors";
import type {
  EvolutionConstraintEngineShape,
  EvolutionConstraintValidationInput,
} from "./types";

export const validateCandidateConstraints = (
  input: EvolutionConstraintValidationInput,
): Effect.Effect<void, EvolutionConstraintError> => {
  const passing = new Set(
    input.candidate.constraints
      .filter((result) => result.passed)
      .map((result) => result.constraint),
  );
  const missing = input.requiredConstraints.find(
    (constraint) => !passing.has(constraint),
  );
  return missing === undefined
    ? Effect.void
    : EvolutionConstraintError.make({
      targetRef: input.targetRef,
      constraint: missing,
      reason: "required candidate constraint is missing or failed",
    });
};

export const makeEvolutionConstraintEngine =
  (): EvolutionConstraintEngineShape => ({
    validate: validateCandidateConstraints,
  });
