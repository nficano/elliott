import { describe, expect, it } from "bun:test";
import { digest, principalId } from "../../src/core/brands";
import { decideProposalOutcome } from "../../src/learning/evolution/application/index";
import type { Proposal } from "../../src/learning/types";

const AUTHOR = principalId("author");
const REVIEWER = principalId("reviewer");
const SECOND_REVIEWER = principalId("second-reviewer");

const SINGLE_REVIEW = 1;
const DOUBLE_REVIEW = 2;

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "prop-1",
  directory: "/proposals/prop-1",
  author: AUTHOR,
  target: { ref: "target-ref", digest: digest("digest-value") },
  signals: [],
  artifacts: {
    rationale: "",
    targetYaml: "",
    patch: "",
    evidenceYaml: "",
    permissionDiffYaml: "",
    evaluationPlanYaml: "",
    support: {},
  },
  status: "authored",
  ...overrides,
});

describe("decideProposalOutcome", () => {
  it("blocks an author approving their own proposal", () => {
    const result = decideProposalOutcome(
      makeProposal(),
      AUTHOR,
      "approved",
      SINGLE_REVIEW,
    );
    expect(result).toEqual({
      kind: "guard-violation",
      violation: "self-approval",
    });
  });

  it("allows an author to reject their own proposal", () => {
    const result = decideProposalOutcome(
      makeProposal(),
      AUTHOR,
      "rejected",
      SINGLE_REVIEW,
    );
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.decision).toBe("rejected");
    expect(result.updated.status).toBe("rejected");
    expect(result.updated.approver).toBe(AUTHOR);
  });

  it("records a rejection with the reviewer as approver", () => {
    const result = decideProposalOutcome(
      makeProposal(),
      REVIEWER,
      "rejected",
      SINGLE_REVIEW,
    );
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.decision).toBe("rejected");
    expect(result.updated.status).toBe("rejected");
    expect(result.updated.approver).toBe(REVIEWER);
  });

  it("blocks a duplicate reviewer recorded via the approvers list", () => {
    const result = decideProposalOutcome(
      makeProposal({ status: "awaiting-review", approvers: [REVIEWER] }),
      REVIEWER,
      "approved",
      DOUBLE_REVIEW,
    );
    expect(result).toEqual({
      kind: "guard-violation",
      violation: "duplicate-reviewer",
    });
  });

  it("blocks a duplicate reviewer recorded via the single approver field", () => {
    const result = decideProposalOutcome(
      makeProposal({ status: "awaiting-review", approver: REVIEWER }),
      REVIEWER,
      "approved",
      DOUBLE_REVIEW,
    );
    expect(result).toEqual({
      kind: "guard-violation",
      violation: "duplicate-reviewer",
    });
  });

  it("accumulates below threshold to awaiting-review without a decision", () => {
    const result = decideProposalOutcome(
      makeProposal(),
      REVIEWER,
      "approved",
      DOUBLE_REVIEW,
    );
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.decision).toBeUndefined();
    expect(result.updated.status).toBe("awaiting-review");
    expect(result.updated.approver).toBe(REVIEWER);
    expect(result.updated.approvers).toEqual([REVIEWER]);
  });

  it("crosses the threshold with a single required review to approved", () => {
    const result = decideProposalOutcome(
      makeProposal(),
      REVIEWER,
      "approved",
      SINGLE_REVIEW,
    );
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.decision).toBe("approved");
    expect(result.updated.status).toBe("approved");
    expect(result.updated.approvers).toEqual([REVIEWER]);
  });

  it("crosses the threshold by adding a second distinct approver", () => {
    const result = decideProposalOutcome(
      makeProposal({ status: "awaiting-review", approvers: [REVIEWER] }),
      SECOND_REVIEWER,
      "approved",
      DOUBLE_REVIEW,
    );
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.decision).toBe("approved");
    expect(result.updated.status).toBe("approved");
    expect(result.updated.approvers).toEqual([REVIEWER, SECOND_REVIEWER]);
  });
});
