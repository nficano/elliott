import { hashValue } from "../../../core/digest";
import { proposalApprovers } from "../../proposals/reviews";
import type { EvolutionAcceptanceLineageArtifacts } from "./types";

export const evolutionProductionLineageDigest = (
  artifacts: EvolutionAcceptanceLineageArtifacts,
): string =>
  hashValue({
    release: artifacts.release,
    canaryRelease: artifacts.canaryRelease,
    rollbackRelease: artifacts.rollbackRelease,
    run: artifacts.run,
    candidate: artifacts.candidate,
    dataset: artifacts.dataset,
    report: artifacts.report,
    proposal: {
      id: artifacts.proposal.id,
      author: artifacts.proposal.author,
      target: artifacts.proposal.target,
      signals: artifacts.proposal.signals,
      artifacts: {
        ...artifacts.proposal.artifacts,
        support: Object.entries(artifacts.proposal.artifacts.support).toSorted(
          ([left], [right]) => left.localeCompare(right),
        ),
      },
      status: artifacts.proposal.status,
      approvers: proposalApprovers(artifacts.proposal),
      evolution: artifacts.proposal.evolution,
    },
    snapshots: {
      baseline: artifacts.baselineSnapshot,
      evaluation: artifacts.evaluationSnapshot,
      release: artifacts.releaseSnapshot,
      rollback: artifacts.rollbackSnapshot,
    },
  });
