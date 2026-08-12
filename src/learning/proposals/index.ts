import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scopeId } from "../../core/brands";
import { newId } from "../../core/digest";
import type {
  Proposal,
  ProposalAuthorInput,
  ProposalStoreConfig,
} from "../types";
import {
  assertProposalUpdate,
  loadProposal,
  proposalMetadata,
  proposalRecordType,
} from "./codec";
import { proposalApprovers } from "./reviews";

export class FileProposalStore {
  readonly #config: ProposalStoreConfig;
  readonly #proposals = new Map<string, Proposal>();

  constructor(config: ProposalStoreConfig) {
    this.#config = config;
  }

  static async open(config: ProposalStoreConfig): Promise<FileProposalStore> {
    const store = new FileProposalStore(config);
    await store.reload();
    return store;
  }

  async author(input: ProposalAuthorInput): Promise<Proposal> {
    const { author, target, signals, artifacts } = input;
    const id = newId("prp");
    const directory = path.resolve(this.#config.root, id);
    if (
      !directory.startsWith(`${path.resolve(this.#config.root)}${path.sep}`)
    ) throw new Error("Proposal directory escapes the configured root");
    const proposal: Proposal = Object.freeze({
      id,
      directory,
      author,
      target,
      signals: Object.freeze([...signals]),
      artifacts,
      status: "authored",
      ...(input.evolution !== undefined && { evolution: input.evolution }),
    });
    await this.#write(proposal);
    this.#proposals.set(id, proposal);
    await this.#config.records.append({
      type: "proposal.authored",
      scope: { level: "principal", id: scopeId(author) },
      durability: "observational",
      classification: "internal",
      payload: { id, target: target.ref, targetDigest: target.digest },
    });
    return proposal;
  }

  get(id: string): Proposal | undefined {
    return this.#proposals.get(id);
  }

  async update(proposal: Proposal): Promise<void> {
    const existing = this.#proposals.get(proposal.id);
    if (existing === undefined) {
      throw new Error(`Unknown Proposal ${proposal.id}`);
    }
    assertProposalUpdate(existing, proposal);
    const effectGating = proposal.status === "awaiting-review"
      || proposal.status === "approved"
      || proposal.status === "rejected";
    await this.#config.records.append({
      type: proposalRecordType(proposal.status),
      scope: { level: "principal", id: scopeId(proposal.author) },
      durability: effectGating ? "effect-gating" : "observational",
      classification: "internal",
      payload: {
        id: proposal.id,
        status: proposal.status,
        target: proposal.target.ref,
        targetDigest: proposal.target.digest,
        ...(proposal.approver !== undefined && { approver: proposal.approver }),
        approvers: proposalApprovers(proposal),
      },
    });
    await writeFile(
      path.join(proposal.directory, "proposal.yaml"),
      proposalMetadata(proposal),
    );
    this.#proposals.set(proposal.id, proposal);
  }

  async reload(): Promise<void> {
    await mkdir(this.#config.root, { recursive: true });
    const entries = await readdir(this.#config.root, { withFileTypes: true });
    const proposals = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) =>
        loadProposal(path.resolve(this.#config.root, entry.name))
      ),
    );
    this.#proposals.clear();
    for (const proposal of proposals) {
      this.#proposals.set(proposal.id, proposal);
    }
  }

  async #write(proposal: Proposal): Promise<void> {
    await mkdir(path.join(proposal.directory, "support"), { recursive: true });
    const files: readonly (readonly [string, string])[] = [
      ["proposal.yaml", proposalMetadata(proposal)],
      ["PROPOSAL.md", proposal.artifacts.rationale],
      ["target.yaml", proposal.artifacts.targetYaml],
      ["patch.diff", proposal.artifacts.patch],
      ["evidence.yaml", proposal.artifacts.evidenceYaml],
      ["permission-diff.yaml", proposal.artifacts.permissionDiffYaml],
      ["eval-plan.yaml", proposal.artifacts.evaluationPlanYaml],
      ...(proposal.artifacts.candidateYaml === undefined
        ? []
        : [["candidate.yaml", proposal.artifacts.candidateYaml] as const]),
      ...(proposal.artifacts.lineageYaml === undefined
        ? []
        : [["lineage.yaml", proposal.artifacts.lineageYaml] as const]),
      ...(proposal.artifacts.datasetYaml === undefined
        ? []
        : [["dataset.yaml", proposal.artifacts.datasetYaml] as const]),
      ...(proposal.artifacts.comparisonYaml === undefined
        ? []
        : [["comparison.yaml", proposal.artifacts.comparisonYaml] as const]),
      ...(proposal.artifacts.footprintsYaml === undefined
        ? []
        : [["footprints.yaml", proposal.artifacts.footprintsYaml] as const]),
      ...(proposal.artifacts.benchmarksYaml === undefined
        ? []
        : [["benchmarks.yaml", proposal.artifacts.benchmarksYaml] as const]),
      ...(proposal.artifacts.rollbackYaml === undefined
        ? []
        : [["rollback.yaml", proposal.artifacts.rollbackYaml] as const]),
    ];
    await Promise.all(
      files.map(([name, content]) =>
        writeFile(path.join(proposal.directory, name), content, { flag: "wx" })
      ),
    );
    await Promise.all(
      Object.entries(proposal.artifacts.support).map(([name, content]) =>
        writeFile(
          path.join(proposal.directory, "support", path.basename(name)),
          content,
          { flag: "wx" },
        )
      ),
    );
  }
}
