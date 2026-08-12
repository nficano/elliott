import type { Effect } from "effect";
import type { EvolutionConstraintError } from "../errors";
import type { EvolutionCandidate } from "../model/index";

export interface EvolutionConstraintValidationInput {
  readonly targetRef: string;
  readonly candidate: EvolutionCandidate;
  readonly requiredConstraints: readonly string[];
}

export interface EvolutionConstraintEngineShape {
  readonly validate: (
    input: EvolutionConstraintValidationInput,
  ) => Effect.Effect<void, EvolutionConstraintError>;
}
