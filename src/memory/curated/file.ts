import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClassificationStamp, Posture } from "../../config/postures/types";
import { componentRef, digest } from "../../core/brands";
import type { DataClassification } from "../../core/types";
import type {
  CuratedMemoryDocument,
  CuratedMemoryEntry,
  CuratedMemoryPersistence,
  MemoryProvenance,
} from "../types";

const SECTION = "\n\n§\n\n";
const ENTRIES_FILE = "entries.json";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDocument = (value: unknown): value is CuratedMemoryDocument =>
  value === "MEMORY.md" || value === "USER.md";

const isClassification = (value: unknown): value is DataClassification =>
  value === "public"
  || value === "internal"
  || value === "confidential"
  || value === "restricted";

const isPosture = (value: unknown): value is Posture =>
  value === "standard" || value === "hardened" || value === "regulated";

const parseStamp = (value: unknown): ClassificationStamp => {
  if (!isRecord(value)) throw new Error("Invalid curated memory stamp");
  const classification = value["classification"];
  const writtenUnder = value["writtenUnder"];
  if (!isClassification(classification) || !isPosture(writtenUnder)) {
    throw new Error("Invalid curated memory stamp fields");
  }
  return { classification, writtenUnder };
};

const parseProvenance = (value: unknown): MemoryProvenance => {
  if (!isRecord(value) || typeof value["source"] !== "string") {
    throw new Error("Invalid curated memory provenance");
  }
  const source = componentRef(value["source"]);
  const original = value["originalRecord"];
  if (original === undefined) return { source };
  if (typeof original !== "string") {
    throw new TypeError("Invalid original memory record digest");
  }
  return { source, originalRecord: digest(original) };
};

const parseEntry = (value: unknown): CuratedMemoryEntry => {
  if (!isRecord(value) || !isDocument(value["document"])) {
    throw new Error("Invalid curated memory entry");
  }
  if (
    typeof value["id"] !== "string"
    || typeof value["content"] !== "string"
    || typeof value["createdAt"] !== "string"
  ) {
    throw new TypeError("Invalid curated memory entry fields");
  }
  return Object.freeze({
    id: digest(value["id"]),
    document: value["document"],
    content: value["content"],
    stamp: parseStamp(value["stamp"]),
    provenance: parseProvenance(value["provenance"]),
    createdAt: value["createdAt"],
  });
};

const render = (
  entries: readonly CuratedMemoryEntry[],
  document: CuratedMemoryDocument,
): string =>
  `${
    entries.filter((entry) => entry.document === document)
      .map((entry) => entry.content)
      .join(SECTION)
  }\n`;

export class FileCuratedMemoryPersistence implements CuratedMemoryPersistence {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  async load(): Promise<readonly CuratedMemoryEntry[]> {
    try {
      const source = await readFile(
        path.join(this.#directory, ENTRIES_FILE),
        "utf8",
      );
      const value: unknown = JSON.parse(source);
      if (!Array.isArray(value)) throw new Error("Invalid curated memory file");
      return value.map(parseEntry);
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") return [];
      throw error;
    }
  }

  async save(entries: readonly CuratedMemoryEntry[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(this.#directory, ENTRIES_FILE),
        `${JSON.stringify(entries, null, 2)}\n`,
      ),
      writeFile(
        path.join(this.#directory, "MEMORY.md"),
        render(entries, "MEMORY.md"),
      ),
      writeFile(
        path.join(this.#directory, "USER.md"),
        render(entries, "USER.md"),
      ),
    ]);
  }
}
