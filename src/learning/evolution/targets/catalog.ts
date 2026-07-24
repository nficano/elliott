import * as Schema from "effect/Schema";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SnapshotId } from "../../../core/types";
import {
  EvolutionPromptSourceRevision,
  EvolutionToolDescriptionRevision,
} from "../model/index";

export class EvolutionArtifactCatalog {
  readonly #tools = new Map<string, EvolutionToolDescriptionRevision>();
  readonly #prompts = new Map<string, EvolutionPromptSourceRevision>();

  registerToolRevision(revision: EvolutionToolDescriptionRevision): void {
    if (this.#tools.has(revision.catalogDigest)) {
      throw new Error(`Duplicate tool catalog ${revision.catalogDigest}`);
    }
    this.#tools.set(revision.catalogDigest, revision);
  }

  registerPromptRevision(revision: EvolutionPromptSourceRevision): void {
    if (this.#prompts.has(revision.sourceDigest)) {
      throw new Error(`Duplicate prompt source ${revision.sourceDigest}`);
    }
    this.#prompts.set(revision.sourceDigest, revision);
  }

  toolsForSnapshot(snapshotId: SnapshotId): EvolutionToolDescriptionRevision {
    const revision = [...this.#tools.values()].find(
      (item) => item.snapshotId === snapshotId,
    );
    if (revision === undefined) {
      throw new Error(`No tool description catalog for ${snapshotId}`);
    }
    return revision;
  }

  promptForSnapshot(
    snapshotId: SnapshotId,
    sourceId: string,
  ): EvolutionPromptSourceRevision {
    const revision = [...this.#prompts.values()].find(
      (item) => item.snapshotId === snapshotId && item.sourceId === sourceId,
    );
    if (revision === undefined) {
      throw new Error(`No prompt source ${sourceId} for ${snapshotId}`);
    }
    return revision;
  }
}

const artifactFileName = (digest: string): string =>
  `${Buffer.from(digest).toString("base64url")}.json`;

const writeImmutableArtifact = (
  directory: string,
  digest: string,
  value: unknown,
): void => {
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, artifactFileName(digest));
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, undefined, 2)}\n`,
    { flag: "wx" },
  );
  try {
    linkSync(temporaryPath, filePath);
  } finally {
    unlinkSync(temporaryPath);
  }
};

const loadArtifacts = <Artifact>(
  directory: string,
  decode: (input: unknown) => Artifact,
): readonly Artifact[] => {
  mkdirSync(directory, { recursive: true });
  return readdirSync(directory)
    .filter((name) => path.extname(name) === ".json")
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) =>
      decode(JSON.parse(readFileSync(path.join(directory, name), "utf8")))
    );
};

export class FileEvolutionArtifactCatalog extends EvolutionArtifactCatalog {
  readonly #toolDirectory: string;
  readonly #promptDirectory: string;

  constructor(root: string) {
    super();
    const resolved = path.resolve(root);
    this.#toolDirectory = path.join(resolved, "tool-revisions");
    this.#promptDirectory = path.join(resolved, "prompt-revisions");
    for (
      const revision of loadArtifacts(
        this.#toolDirectory,
        Schema.decodeUnknownSync(EvolutionToolDescriptionRevision),
      )
    ) super.registerToolRevision(revision);
    for (
      const revision of loadArtifacts(
        this.#promptDirectory,
        Schema.decodeUnknownSync(EvolutionPromptSourceRevision),
      )
    ) super.registerPromptRevision(revision);
  }

  override registerToolRevision(
    revision: EvolutionToolDescriptionRevision,
  ): void {
    writeImmutableArtifact(
      this.#toolDirectory,
      revision.catalogDigest,
      revision,
    );
    super.registerToolRevision(revision);
  }

  override registerPromptRevision(
    revision: EvolutionPromptSourceRevision,
  ): void {
    writeImmutableArtifact(
      this.#promptDirectory,
      revision.sourceDigest,
      revision,
    );
    super.registerPromptRevision(revision);
  }
}
