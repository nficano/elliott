import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { EvolutionPromotionError } from "../errors";
import type { EvolutionGitProjectionInput } from "./git/types";

export const projectEvolutionProposalToGit = Effect.fn(
  "projectEvolutionProposalToGit",
)(function*(input: EvolutionGitProjectionInput) {
  if (input.proposal.status !== "authored") {
    return yield* EvolutionPromotionError.make({
      proposalId: input.proposal.id,
      stage: "git-projection",
      reason: "only an authored, unapproved Proposal can be projected",
    });
  }
  const branchName = `elliott/evolution/${input.proposal.id}`;
  yield* Effect.tryPromise({
    try: () =>
      input.records.append({
        type: "evolution.git.publication-intent",
        scope: { level: "principal", id: scopeId(input.principalId) },
        durability: "effect-gating",
        classification: "internal",
        payload: {
          proposalId: input.proposal.id,
          repositoryRef: input.repositoryRef,
          branchName,
        },
      }),
    catch: (cause) =>
      EvolutionPromotionError.make({
        proposalId: input.proposal.id,
        stage: "git-publication-intent",
        reason: "publication intent was not durable",
        cause,
      }),
  });
  return yield* Effect.tryPromise({
    try: () => input.adapter.publishDraft(input.proposal, branchName),
    catch: (cause) =>
      EvolutionPromotionError.make({
        proposalId: input.proposal.id,
        stage: "git-projection",
        reason: "failed to create draft Git projection",
        cause,
      }),
  });
});
