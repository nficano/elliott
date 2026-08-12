import * as Effect from "effect/Effect";
import { EvolutionConstraintError } from "../errors";
import type { EvolutionCandidate } from "../model/index";

export const validateCandidateLineage = Effect.fn("validateCandidateLineage")(
  function*(candidates: readonly EvolutionCandidate[]) {
    const byId = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    for (const candidate of candidates) {
      const visited = new Set<string>();
      let current: EvolutionCandidate | undefined = candidate;
      while (current?.parentCandidateId !== undefined) {
        if (visited.has(current.parentCandidateId)) {
          return yield* EvolutionConstraintError.make({
            targetRef: candidate.runId,
            constraint: "candidate-lineage",
            reason: `cycle detected at ${current.parentCandidateId}`,
          });
        }
        visited.add(current.parentCandidateId);
        const parent: EvolutionCandidate | undefined = byId.get(
          current.parentCandidateId,
        );
        if (parent === undefined || parent.runId !== candidate.runId) {
          return yield* EvolutionConstraintError.make({
            targetRef: candidate.runId,
            constraint: "candidate-lineage",
            reason: `missing or cross-run parent ${current.parentCandidateId}`,
          });
        }
        current = parent;
      }
    }
  },
);
