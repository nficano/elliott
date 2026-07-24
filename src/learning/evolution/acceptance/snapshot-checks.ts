import { isJsonRecord } from "../../../providers/http";
import { acceptanceFinding } from "./finding";
import type { EvolutionAcceptanceLineageAuditInput } from "./types";

const sameText = (
  left: string | undefined,
  right: string,
): boolean => left === right;

export const snapshotFindings = (
  input: EvolutionAcceptanceLineageAuditInput,
) => {
  const { artifacts, evidence } = input;
  const configuration = artifacts.releaseSnapshot.configuration;
  const activeTargets = configuration["evolutionActiveTargets"];
  const snapshotMatches = [
    sameText(artifacts.baselineSnapshot.id, evidence.baselineSnapshotId),
    sameText(
      artifacts.evaluationSnapshot.id,
      evidence.evaluationSnapshotId,
    ),
    sameText(
      artifacts.evaluationSnapshot.previous,
      evidence.baselineSnapshotId,
    ),
    sameText(artifacts.releaseSnapshot.id, evidence.snapshotId),
    sameText(artifacts.releaseSnapshot.previous, evidence.baselineSnapshotId),
    configuration["evolutionRevisionDigest"] === evidence.revisionDigest,
    isJsonRecord(activeTargets)
    && activeTargets[evidence.targetRef] === evidence.targetDigest,
    sameText(
      artifacts.rollbackSnapshot.id,
      artifacts.rollbackRelease.snapshotId,
    ),
    sameText(artifacts.rollbackSnapshot.previous, evidence.snapshotId),
  ].every(Boolean);
  return snapshotMatches
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.snapshots`,
      "baseline, evaluation, release, or rollback Snapshot lineage is invalid",
    )];
};
