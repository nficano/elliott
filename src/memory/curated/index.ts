import { PostureController } from "../../config/postures/index";
import { hashValue } from "../../core/digest";
import type {
  CuratedMemoryConfig,
  CuratedMemoryDocument,
  CuratedMemoryEntry,
  CuratedMemoryMutation,
  CuratedMemoryPersistence,
  CuratedMemorySnapshot,
} from "../types";

const SECTION = "\n\n§\n\n";
const CLASSIFICATIONS = new Set([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const POSTURES = new Set(["standard", "hardened", "regulated"]);

const renderDocument = (
  document: CuratedMemoryDocument,
  entries: readonly CuratedMemoryEntry[],
): string =>
  entries.filter((entry) => entry.document === document)
    .map((entry) => entry.content)
    .join(SECTION);

// A stored entry is valid when its stamp names a known classification and
// posture and its id is the content hash of the entry — a mismatch means the id
// or a stamped field was tampered with after the entry was minted. Pure.
export const isCuratedEntryValid = (entry: CuratedMemoryEntry): boolean =>
  CLASSIFICATIONS.has(entry.stamp?.classification)
  && POSTURES.has(entry.stamp?.writtenUnder)
  && entry.id === hashValue({
      document: entry.document,
      content: entry.content,
      stamp: entry.stamp,
      provenance: entry.provenance,
    });

// Throw the loader's tamper error if any entry fails validation. Pure.
export const assertCuratedEntriesValid = (
  entries: readonly CuratedMemoryEntry[],
): void => {
  for (const entry of entries) {
    if (!isCuratedEntryValid(entry)) {
      throw new Error(
        "Memory provider returned an invalid classification stamp",
      );
    }
  }
};

export class InMemoryCuratedPersistence implements CuratedMemoryPersistence {
  #entries: readonly CuratedMemoryEntry[] = Object.freeze([]);

  async load(): Promise<readonly CuratedMemoryEntry[]> {
    return this.#entries;
  }

  async save(entries: readonly CuratedMemoryEntry[]): Promise<void> {
    this.#entries = Object.freeze([...entries]);
  }
}

export class CuratedMemoryStore {
  readonly #config: CuratedMemoryConfig;
  #entries: readonly CuratedMemoryEntry[] = Object.freeze([]);

  constructor(config: CuratedMemoryConfig) {
    this.#config = config;
  }

  async initialize(): Promise<void> {
    const entries = await this.#config.persistence.load();
    assertCuratedEntriesValid(entries);
    this.#entries = Object.freeze([...entries]);
  }

  list(): readonly CuratedMemoryEntry[] {
    return this.#entries;
  }

  beginSession(sessionId: string): CuratedMemorySnapshot {
    const entries = Object.freeze([...this.#entries]);
    return Object.freeze({
      sessionId,
      entries,
      prefix: [
        "# MEMORY.md",
        renderDocument("MEMORY.md", entries),
        "# USER.md",
        renderDocument("USER.md", entries),
      ].join("\n"),
    });
  }

  async mutate(
    mutation: CuratedMemoryMutation,
  ): Promise<CuratedMemoryEntry | undefined> {
    const next = this.#apply(mutation);
    this.#assertBounded(mutation.document, next.entries);
    this.#entries = Object.freeze(next.entries);
    await this.#config.persistence.save(this.#entries);
    return next.entry;
  }

  #apply(mutation: CuratedMemoryMutation): {
    readonly entries: readonly CuratedMemoryEntry[];
    readonly entry?: CuratedMemoryEntry;
  } {
    if (mutation.action === "add") {
      const controller = new PostureController(this.#config.posture());
      const stamp = controller.stamp(mutation.classification);
      const entry: CuratedMemoryEntry = Object.freeze({
        id: hashValue({
          document: mutation.document,
          content: mutation.content,
          stamp,
          provenance: mutation.provenance,
        }),
        document: mutation.document,
        content: mutation.content,
        stamp,
        provenance: mutation.provenance,
        createdAt: new Date().toISOString(),
      });
      return { entries: [...this.#entries, entry], entry };
    }
    const index = this.#match(mutation);
    if (index === -1) return { entries: this.#entries };
    if (mutation.action === "remove") {
      return { entries: this.#entries.filter((_, item) => item !== index) };
    }
    const original = this.#entries[index];
    if (original === undefined) return { entries: this.#entries };
    const replacement = this.#apply({
      ...mutation,
      action: "add",
      provenance: {
        ...mutation.provenance,
        originalRecord: original.id,
      },
    }).entry;
    if (replacement === undefined) return { entries: this.#entries };
    return {
      entries: this.#entries.map((entry, item) =>
        item === index ? replacement : entry
      ),
      entry: replacement,
    };
  }

  #match(mutation: CuratedMemoryMutation): number {
    const match = mutation.match;
    if (match === undefined || match.length === 0) return -1;
    return this.#entries.findIndex((entry) =>
      entry.document === mutation.document && entry.content.includes(match)
    );
  }

  #assertBounded(
    document: CuratedMemoryDocument,
    entries: readonly CuratedMemoryEntry[],
  ): void {
    const length = renderDocument(document, entries).length;
    if (length > this.#config.maximumCharacters[document]) {
      throw new Error(`${document} exceeds its character budget`);
    }
  }
}
