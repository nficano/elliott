import type { PrincipalId } from "../../core/types";
import { signalsPermitPromotion } from "../signals/index";
import type {
  Proposal,
  ProposalDeployment,
  ProposalEvaluationReport,
  ProposalEvaluationStage,
  ProposalStageResult,
  ProposalStageRunner,
} from "../types";

export const EVALUATION_STAGES: readonly ProposalEvaluationStage[] = [
  "yaml-validation",
  "markdown-validation",
  "manifest-schema-validation",
  "path-containment",
  "permission-delta-analysis",
  "static-security-analysis",
  "unit-contract-tests",
  "clean-context-evaluation",
  "comparative-evaluation",
  "adversarial-injection-tests",
  "cost-latency-comparison",
  "canary-execution",
];

export class ProposalEvaluator {
  readonly #runner: ProposalStageRunner;

  constructor(runner: ProposalStageRunner) {
    this.#runner = runner;
  }

  async evaluate(proposal: Proposal): Promise<ProposalEvaluationReport> {
    const results: ProposalStageResult[] = [];
    for (const stage of EVALUATION_STAGES) {
      const result = await this.#runner.run(proposal, stage);
      results.push(result);
      if (!result.passed) break;
    }
    return Object.freeze({
      proposalId: proposal.id,
      results: Object.freeze(results),
      passed: results.length === EVALUATION_STAGES.length
        && results.every((result) => result.passed),
    });
  }
}

export const approveProposal = (
  proposal: Proposal,
  approver: PrincipalId,
  report: ProposalEvaluationReport,
): Proposal => {
  if (proposal.author === approver) {
    throw new Error("A Proposal author cannot approve their own change");
  }
  if (!report.passed) throw new Error("A failing Proposal cannot be approved");
  return Object.freeze({ ...proposal, status: "approved", approver });
};

export const promoteProposal = async (
  proposal: Proposal,
  promoter: PrincipalId,
  deployment: ProposalDeployment,
): Promise<Proposal> => {
  if (proposal.author === promoter) {
    throw new Error("A Proposal author cannot promote their own change");
  }
  if (
    proposal.status !== "approved" || !signalsPermitPromotion(proposal.signals)
  ) {
    throw new Error("Proposal is not eligible for promotion");
  }
  if (
    await deployment.activeDigest(proposal.target.ref)
      !== proposal.target.digest
  ) {
    return Object.freeze({ ...proposal, status: "stale" });
  }
  await deployment.promote(proposal);
  return Object.freeze({ ...proposal, status: "promoted" });
};
