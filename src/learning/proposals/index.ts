import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { scopeId } from "../../core/brands";
import { newId } from "../../core/digest";
import type {
  Proposal,
  ProposalAuthorInput,
  ProposalStoreConfig,
} from "../types";

const proposalMetadata = (proposal: Proposal): string =>
  stringify({
    id: proposal.id,
    author: proposal.author,
    target: proposal.target,
    status: proposal.status,
  });

export class FileProposalStore {
  readonly #config: ProposalStoreConfig;
  readonly #proposals = new Map<string, Proposal>();

  constructor(config: ProposalStoreConfig) {
    this.#config = config;
  }

  async author(input: ProposalAuthorInput): Promise<Proposal> {
    const { author, target, signals, artifacts } = input;
    const id = newId("prp");
    const directory = path.resolve(this.#config.root, id);
    if (
      !directory.startsWith(`${path.resolve(this.#config.root)}${path.sep}`)
    ) {
      throw new Error("Proposal directory escapes the configured root");
    }
    const proposal: Proposal = Object.freeze({
      id,
      directory,
      author,
      target,
      signals: Object.freeze([...signals]),
      artifacts,
      status: "authored",
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

  update(proposal: Proposal): void {
    this.#proposals.set(proposal.id, proposal);
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
