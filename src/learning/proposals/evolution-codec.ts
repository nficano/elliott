import { isJsonRecord } from "../../providers/http";
import type { ProposalEvolutionMetadata } from "../types";

const requireString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  filePath: string,
): string => {
  const field = value[key];
  if (typeof field !== "string") {
    throw new TypeError(`${filePath} has invalid evolution.${key}`);
  }
  return field;
};

const targetClass = (
  value: string,
  filePath: string,
): ProposalEvolutionMetadata["targetClass"] => {
  switch (value) {
    case "skill":
    case "tool-description":
    case "prompt-segment":
    case "code": {
      return value;
    }
    default: {
      throw new TypeError(`${filePath} has invalid evolution target class`);
    }
  }
};

const riskClass = (
  value: string,
  filePath: string,
): ProposalEvolutionMetadata["riskClass"] => {
  switch (value) {
    case "C1":
    case "C2":
    case "C3":
    case "C4": {
      return value;
    }
    default: {
      throw new TypeError(`${filePath} has invalid evolution risk class`);
    }
  }
};

export const decodeProposalEvolutionMetadata = (
  value: unknown,
  filePath: string,
): ProposalEvolutionMetadata | undefined => {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw new TypeError(`${filePath} has invalid evolution metadata`);
  }
  return {
    runId: requireString(value, "runId", filePath),
    targetClass: targetClass(
      requireString(value, "targetClass", filePath),
      filePath,
    ),
    riskClass: riskClass(
      requireString(value, "riskClass", filePath),
      filePath,
    ),
    candidateDigest: requireString(value, "candidateDigest", filePath),
    baselineSnapshotId: requireString(value, "baselineSnapshotId", filePath),
    candidateSnapshotId: requireString(value, "candidateSnapshotId", filePath),
    evaluationReportId: requireString(value, "evaluationReportId", filePath),
    datasetDigest: requireString(value, "datasetDigest", filePath),
  };
};

export const requiredEvolutionReviewCount = (
  metadata: ProposalEvolutionMetadata | undefined,
): number =>
  metadata?.riskClass === "C3" || metadata?.riskClass === "C4" ? 2 : 1;
