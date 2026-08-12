import * as Effect from "effect/Effect";
import { evolutionTargetAllowed } from "../config";
import { EvolutionAuthorityError } from "../errors";
import type { EvolutionPolicyInput } from "./types";

const C1_RANK = 1;
const C2_RANK = 2;
const C3_RANK = 3;
const C4_RANK = 4;

const riskRank = new Map([
  ["C1", C1_RANK],
  ["C2", C2_RANK],
  ["C3", C3_RANK],
  ["C4", C4_RANK],
]);

export const assertEvolutionPolicy = (
  input: EvolutionPolicyInput,
): Effect.Effect<void, EvolutionAuthorityError> => {
  const isolated = input.engineIsolation === "container"
    || input.engineIsolation === "remote";
  const riskAllowed = !input.continuous
    || (riskRank.get(input.riskClass) ?? Infinity)
      <= (riskRank.get(input.config.continuous.maximumRiskClass) ?? 0);
  const classificationAllowed = input.classification !== "restricted"
    || input.engineLocal;
  const targetAllowed = evolutionTargetAllowed(input.config, input.targetRef);
  return isolated && riskAllowed && classificationAllowed && targetAllowed
    ? Effect.void
    : EvolutionAuthorityError.make({
      principalId: "EvolutionProposalAuthor",
      action: "scope-evolution-run",
      reason:
        `policy rejected target ${input.targetRef} with engine ${input.engineRef}`,
    });
};
