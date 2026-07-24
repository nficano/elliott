import * as Effect from "effect/Effect";
import { EvolutionAuthorityError, EvolutionDatasetError } from "../errors";
import type { EvolutionDatasetCase } from "../model/index";
import type { EvolutionDatasetSplit } from "./types";

const fingerprint = (value: unknown): string =>
  JSON.stringify(value).toLowerCase().replaceAll(/\s+/g, "");

export const validateDatasetLeakage = Effect.fn(
  "validateDatasetLeakage",
)(function*(
  cases: readonly EvolutionDatasetCase[],
): Effect.fn.Return<void, EvolutionDatasetError> {
  const caseIds = new Set<string>();
  const groups = new Map<string, EvolutionDatasetSplit>();
  const fingerprints = new Map<string, EvolutionDatasetSplit>();
  for (const item of cases) {
    if (caseIds.has(item.id)) {
      return yield* EvolutionDatasetError.make({
        operation: "validateLeakage",
        reason: "duplicate case identifier",
        caseIds: [item.id],
      });
    }
    caseIds.add(item.id);
    const groupSplit = groups.get(item.groupId);
    if (groupSplit !== undefined && groupSplit !== item.split) {
      return yield* EvolutionDatasetError.make({
        operation: "validateLeakage",
        reason: "related group crosses dataset splits",
        caseIds: [item.id],
      });
    }
    groups.set(item.groupId, item.split);
    const inputFingerprint = fingerprint(item.input);
    const fingerprintSplit = fingerprints.get(inputFingerprint);
    if (fingerprintSplit !== undefined && fingerprintSplit !== item.split) {
      return yield* EvolutionDatasetError.make({
        operation: "validateLeakage",
        reason: "duplicate or near-duplicate input crosses dataset splits",
        caseIds: [item.id],
      });
    }
    fingerprints.set(inputFingerprint, item.split);
  }
});

export const assertDatasetSplitAccess = (
  principalRole: string,
  split: EvolutionDatasetSplit,
): Effect.Effect<void, EvolutionAuthorityError> =>
  principalRole === "EvolutionOptimizer" && split === "holdout"
    ? EvolutionAuthorityError.make({
      principalId: principalRole,
      action: "read-evolution-holdout",
      reason: "optimizer principals never receive holdout access",
    })
    : Effect.void;
