import { scopeId } from "../core/brands";
import { hashValue, newId } from "../core/digest";
import type { Digest } from "../core/types";
import type {
  RecordAppender,
  RecordDraft,
  RecordEvent,
} from "../core/waist/types";
import { merkleRoot } from "./crosslink/index";
import { GroupCommitter } from "./durability/index";
import {
  auditShardKey,
  createAuditRecord,
  verifyAuditRecord,
} from "./shards/index";
import type {
  AuditCommitAdapter,
  AuditCrossLink,
  AuditSnapshot,
  AuditVerification,
} from "./types";

const DEFAULT_OBSERVATIONAL_TAIL = 128;

// Assemble one cross-link over the current shards: sort shards by key, take each
// non-empty shard's head digest and length, fold the heads into a Merkle root,
// and chain a digest onto the previous cross-link's digest. Pure; the caller
// supplies the id and timestamp so the result is deterministic and verifiable.
export const buildCrossLink = (input: {
  readonly shards: ReadonlyMap<string, RecordEvent[]>;
  readonly previousLink: AuditCrossLink | undefined;
  readonly id: string;
  readonly timestamp: string;
}): AuditCrossLink => {
  const { shards, previousLink, id, timestamp } = input;
  const shardHeads: Record<string, Digest> = {};
  const shardLengths: Record<string, number> = {};
  for (
    const [key, records] of [...shards].sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  ) {
    const head = records.at(-1);
    if (head === undefined) continue;
    shardHeads[key] = head.digest;
    shardLengths[key] = records.length;
  }
  const root = merkleRoot(Object.values(shardHeads));
  const previousRoot = previousLink?.digest;
  const common = {
    id,
    timestamp,
    shardHeads: Object.freeze(shardHeads),
    shardLengths: Object.freeze(shardLengths),
    merkleRoot: root,
  };
  const crossLinkDigest = hashValue({ ...common, previousRoot });
  return previousRoot === undefined
    ? Object.freeze({ ...common, digest: crossLinkDigest })
    : Object.freeze({
      ...common,
      previousRoot,
      digest: crossLinkDigest,
    });
};

export class AuditLog implements RecordAppender {
  readonly #shards = new Map<string, RecordEvent[]>();
  readonly #crossLinks: AuditCrossLink[] = [];
  readonly #observational: RecordEvent[] = [];
  readonly #committer: GroupCommitter;

  constructor(
    adapter: AuditCommitAdapter,
    readonly observationalTail = DEFAULT_OBSERVATIONAL_TAIL,
  ) {
    this.#committer = new GroupCommitter(adapter);
  }

  async append(draft: RecordDraft): Promise<RecordEvent> {
    const key = auditShardKey(draft);
    const shard = this.#shards.get(key) ?? [];
    const record = createAuditRecord(draft, shard.at(-1)?.digest);
    shard.push(record);
    this.#shards.set(key, shard);
    if (record.durability === "effect-gating") {
      await this.#committer.enqueue([record]);
    } else {
      this.#observational.push(record);
      if (this.#observational.length >= this.observationalTail) {
        await this.flushObservational();
      }
    }
    return record;
  }

  async executeAfterDurable<Value>(
    draft: RecordDraft,
    effect: () => Promise<Value>,
  ): Promise<Value> {
    if (draft.durability !== "effect-gating") {
      throw new Error("External effects require effect-gating records");
    }
    await this.append(draft);
    return effect();
  }

  async flushObservational(): Promise<void> {
    const pending = [...this.#observational];
    this.#observational.length = 0;
    if (pending.length > 0) await this.#committer.enqueue(pending);
  }

  async crossLink(): Promise<AuditCrossLink> {
    await this.flushObservational();
    const link = buildCrossLink({
      shards: this.#shards,
      previousLink: this.#crossLinks.at(-1),
      id: newId("crosslink"),
      timestamp: new Date().toISOString(),
    });
    this.#crossLinks.push(link);
    await this.append({
      type: "audit.crosslink",
      scope: { level: "organization", id: scopeId("audit-root") },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        crossLinkId: link.id,
        merkleRoot: link.merkleRoot,
        crossLinkDigest: link.digest,
      },
    });
    return link;
  }

  snapshot(): AuditSnapshot {
    const shards: Record<string, readonly RecordEvent[]> = {};
    for (const [key, records] of this.#shards) shards[key] = [...records];
    return Object.freeze({
      shards: Object.freeze(shards),
      crossLinks: Object.freeze([...this.#crossLinks]),
    });
  }

  static verify(snapshot: AuditSnapshot): AuditVerification {
    const errors: string[] = [];
    for (const [key, records] of Object.entries(snapshot.shards)) {
      let previous: Digest | undefined;
      for (const record of records) {
        if (!verifyAuditRecord(record, previous)) {
          errors.push(`invalid chain record ${record.id} in ${key}`);
        }
        previous = record.digest;
      }
    }
    AuditLog.#verifyCrossLinks(snapshot, errors);
    return { valid: errors.length === 0, errors };
  }

  static #verifyCrossLinks(snapshot: AuditSnapshot, errors: string[]): void {
    let previousRoot: Digest | undefined;
    for (const link of snapshot.crossLinks) {
      const heads = Object.entries(link.shardLengths).sort((left, right) =>
        left[0].localeCompare(right[0])
      ).map(([key, length]) => snapshot.shards[key]?.[length - 1]?.digest);
      if (heads.includes(undefined)) {
        errors.push(`cross-link ${link.id} references a missing shard head`);
        continue;
      }
      const presentHeads = heads.filter((head) => head !== undefined);
      if (merkleRoot(presentHeads) !== link.merkleRoot) {
        errors.push(`cross-link ${link.id} Merkle root mismatch`);
      }
      const expected = hashValue({
        id: link.id,
        timestamp: link.timestamp,
        shardHeads: link.shardHeads,
        shardLengths: link.shardLengths,
        merkleRoot: link.merkleRoot,
        previousRoot,
      });
      if (link.previousRoot !== previousRoot || link.digest !== expected) {
        errors.push(`cross-link ${link.id} root chain mismatch`);
      }
      previousRoot = link.digest;
    }
  }
}
