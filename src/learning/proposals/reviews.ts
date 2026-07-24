import { principalId } from "../../core/brands";
import type { Proposal } from "../types";
import { requiredEvolutionReviewCount } from "./evolution-codec";

export const proposalApprovers = (
  proposal: Pick<Proposal, "approver" | "approvers">,
): readonly ReturnType<typeof principalId>[] =>
  proposal.approvers
    ?? (proposal.approver === undefined ? [] : [proposal.approver]);

const validateReviewerValues = (
  approverValue: unknown,
  approversValue: unknown,
  filePath: string,
): void => {
  if (
    approversValue !== undefined
    && (
      !Array.isArray(approversValue)
      || approversValue.some((item) => typeof item !== "string")
    )
  ) throw new TypeError(`${filePath} has invalid approvers`);
  if (approverValue !== undefined && typeof approverValue !== "string") {
    throw new TypeError(`${filePath} has invalid approver`);
  }
};

const reviewersFrom = (
  approverValue: unknown,
  approversValue: unknown,
): readonly ReturnType<typeof principalId>[] => {
  let reviewers: readonly ReturnType<typeof principalId>[] = [];
  if (Array.isArray(approversValue)) {
    reviewers = approversValue.flatMap((item) =>
      typeof item === "string" ? [principalId(item)] : []
    );
  } else if (typeof approverValue === "string") {
    reviewers = [principalId(approverValue)];
  }
  return reviewers;
};

export const decodeProposalApprovers = (
  approverValue: unknown,
  approversValue: unknown,
  filePath: string,
): Readonly<{
  approver?: ReturnType<typeof principalId>;
  approvers?: readonly ReturnType<typeof principalId>[];
}> => {
  validateReviewerValues(approverValue, approversValue, filePath);
  const reviewers = reviewersFrom(approverValue, approversValue);
  const approvers = [...new Set(reviewers)];
  const approver = typeof approverValue === "string"
    ? principalId(approverValue)
    : approvers.at(-1);
  return {
    ...(approver !== undefined && { approver }),
    ...(approvers.length > 0 && {
      approvers: Object.freeze(approvers),
    }),
  };
};

export const assertProposalReviews = (proposal: Proposal): void => {
  const approvers = proposalApprovers(proposal);
  if (
    new Set(approvers).size !== approvers.length
    || approvers.includes(proposal.author)
  ) throw new Error("Proposal reviews require distinct non-author principals");
  const required = requiredEvolutionReviewCount(proposal.evolution);
  if (
    proposal.status === "awaiting-review"
    && (approvers.length === 0 || approvers.length >= required)
  ) throw new Error("Proposal partial review count is invalid");
  if (proposal.status === "approved" && approvers.length < required) {
    throw new Error("Proposal does not have every required review");
  }
};
