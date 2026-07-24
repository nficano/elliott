import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { digest, principalId } from "../../core/brands";
import { isJsonRecord } from "../../providers/http";
import {
  DETERMINISTIC_EVALUATOR_RANK,
  EXPLICIT_USER_CORRECTION_RANK,
  EXPLICIT_USER_RESULT_RANK,
  REPEATED_FAILURE_RANK,
  SELF_REFLECTION_RANK,
  SUCCESSFUL_WORKAROUND_RANK,
} from "../types";
import type {
  LearningSignal,
  LearningSignalRank,
  Proposal,
  ProposalStatus,
} from "../types";
import { decodeProposalEvolutionMetadata } from "./evolution-codec";
import { assertProposalReviews, decodeProposalApprovers } from "./reviews";

export const proposalMetadata = (proposal: Proposal): string =>
  stringify({
    id: proposal.id,
    author: proposal.author,
    target: proposal.target,
    status: proposal.status,
    signals: proposal.signals,
    ...(proposal.approver !== undefined && { approver: proposal.approver }),
    ...(proposal.approvers !== undefined && {
      approvers: proposal.approvers,
    }),
    ...(proposal.evolution !== undefined && {
      evolution: proposal.evolution,
    }),
  });

const requireString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  filePath: string,
): string => {
  const field = value[key];
  if (typeof field !== "string") {
    throw new TypeError(`${filePath} has invalid ${key}`);
  }
  return field;
};

const decodeSignalRank = (
  value: unknown,
  filePath: string,
): LearningSignalRank => {
  switch (value) {
    case EXPLICIT_USER_CORRECTION_RANK:
    case EXPLICIT_USER_RESULT_RANK:
    case DETERMINISTIC_EVALUATOR_RANK:
    case SUCCESSFUL_WORKAROUND_RANK:
    case REPEATED_FAILURE_RANK:
    case SELF_REFLECTION_RANK: {
      return value;
    }
    default: {
      throw new TypeError(`${filePath} has an invalid signal rank`);
    }
  }
};

const decodeSignals = (
  value: unknown,
  filePath: string,
): readonly LearningSignal[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${filePath} has invalid signals`);
  }
  return value.map((signal) => {
    if (!isJsonRecord(signal)) {
      throw new TypeError(`${filePath} has an invalid signal`);
    }
    return {
      id: requireString(signal, "id", filePath),
      rank: decodeSignalRank(signal["rank"], filePath),
      source: requireString(signal, "source", filePath),
      evidence: requireString(signal, "evidence", filePath),
      createdAt: requireString(signal, "createdAt", filePath),
    };
  });
};

const decodeProposalStatus = (
  value: unknown,
  filePath: string,
): ProposalStatus => {
  switch (value) {
    case "authored":
    case "evaluated":
    case "awaiting-review":
    case "approved":
    case "promoted":
    case "rejected":
    case "stale": {
      return value;
    }
    default: {
      throw new TypeError(`${filePath} has invalid status`);
    }
  }
};

const readOptionalArtifact = async (
  directory: string,
  name: string,
): Promise<string | undefined> => {
  try {
    return await readFile(path.join(directory, name), "utf8");
  } catch (error) {
    if (
      error instanceof Error && "code" in error && error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
};

const loadArtifacts = async (
  directory: string,
): Promise<Proposal["artifacts"]> => {
  const supportDirectory = path.join(directory, "support");
  const supportNames = await readdir(supportDirectory);
  const supportEntries = await Promise.all(
    supportNames.map(async (name) =>
      [
        name,
        await readFile(path.join(supportDirectory, name), "utf8"),
      ] as const
    ),
  );
  const readArtifact = (name: string) =>
    readFile(path.join(directory, name), "utf8");
  const candidateYaml = await readOptionalArtifact(directory, "candidate.yaml");
  const lineageYaml = await readOptionalArtifact(directory, "lineage.yaml");
  const datasetYaml = await readOptionalArtifact(directory, "dataset.yaml");
  const comparisonYaml = await readOptionalArtifact(
    directory,
    "comparison.yaml",
  );
  const footprintsYaml = await readOptionalArtifact(
    directory,
    "footprints.yaml",
  );
  const benchmarksYaml = await readOptionalArtifact(
    directory,
    "benchmarks.yaml",
  );
  const rollbackYaml = await readOptionalArtifact(directory, "rollback.yaml");
  return {
    rationale: await readArtifact("PROPOSAL.md"),
    targetYaml: await readArtifact("target.yaml"),
    patch: await readArtifact("patch.diff"),
    evidenceYaml: await readArtifact("evidence.yaml"),
    permissionDiffYaml: await readArtifact("permission-diff.yaml"),
    evaluationPlanYaml: await readArtifact("eval-plan.yaml"),
    ...(candidateYaml !== undefined && { candidateYaml }),
    ...(lineageYaml !== undefined && { lineageYaml }),
    ...(datasetYaml !== undefined && { datasetYaml }),
    ...(comparisonYaml !== undefined && { comparisonYaml }),
    ...(footprintsYaml !== undefined && { footprintsYaml }),
    ...(benchmarksYaml !== undefined && { benchmarksYaml }),
    ...(rollbackYaml !== undefined && { rollbackYaml }),
    support: Object.freeze(Object.fromEntries(supportEntries)),
  };
};

export const loadProposal = async (directory: string): Promise<Proposal> => {
  const metadataPath = path.join(directory, "proposal.yaml");
  const raw = await readFile(metadataPath, "utf8");
  const value: unknown = parse(raw);
  if (!isJsonRecord(value) || !isJsonRecord(value["target"])) {
    throw new TypeError(`${metadataPath} is invalid`);
  }
  const approver = value["approver"];
  const approvers = value["approvers"];
  const evolution = decodeProposalEvolutionMetadata(
    value["evolution"],
    metadataPath,
  );
  return Object.freeze({
    id: requireString(value, "id", metadataPath),
    directory,
    author: principalId(requireString(value, "author", metadataPath)),
    target: {
      ref: requireString(value["target"], "ref", metadataPath),
      digest: digest(requireString(value["target"], "digest", metadataPath)),
    },
    signals: Object.freeze(decodeSignals(value["signals"], metadataPath)),
    artifacts: await loadArtifacts(directory),
    status: decodeProposalStatus(value["status"], metadataPath),
    ...decodeProposalApprovers(approver, approvers, metadataPath),
    ...(evolution !== undefined && { evolution }),
  });
};

const transitions = new Map<ProposalStatus, ReadonlySet<ProposalStatus>>([
  [
    "authored",
    new Set([
      "evaluated",
      "awaiting-review",
      "approved",
      "rejected",
      "stale",
    ]),
  ],
  [
    "evaluated",
    new Set(["awaiting-review", "approved", "rejected", "stale"]),
  ],
  [
    "awaiting-review",
    new Set(["awaiting-review", "approved", "rejected", "stale"]),
  ],
  ["approved", new Set(["promoted", "rejected", "stale"])],
]);

const immutableProposalCore = (proposal: Proposal): string =>
  JSON.stringify({
    id: proposal.id,
    directory: proposal.directory,
    author: proposal.author,
    target: proposal.target,
    signals: proposal.signals,
    artifacts: proposal.artifacts,
    evolution: proposal.evolution,
  });

export const assertProposalUpdate = (
  existing: Proposal,
  proposal: Proposal,
): void => {
  if (immutableProposalCore(existing) !== immutableProposalCore(proposal)) {
    throw new Error("Proposal identity and evidence are immutable");
  }
  if (!transitions.get(existing.status)?.has(proposal.status)) {
    throw new Error(
      `Invalid Proposal transition ${existing.status} -> ${proposal.status}`,
    );
  }
  assertProposalReviews(proposal);
};

export const proposalRecordType = (status: ProposalStatus): string => {
  if (status === "approved" || status === "awaiting-review") {
    return "evolution.review.approved";
  }
  if (status === "rejected") return "evolution.review.rejected";
  if (status === "promoted") return "proposal.promoted";
  return `proposal.${status}`;
};
