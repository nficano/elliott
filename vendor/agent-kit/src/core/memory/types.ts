import type * as Effect from "effect/Effect";
import type { MemoryError } from "../errors.js";
import type { Origin } from "../types.js";

/** mem0-style collections (§7.4). */
export type Collection = "episodic" | "semantic" | "learnings" | "inner";
export const COLLECTIONS: readonly Collection[] = [
  "episodic",
  "semantic",
  "learnings",
  "inner",
];

export interface MemoryRecord {
  readonly id: string;
  readonly collection: Collection;
  /** Provenance/trust (§7.4). Recall for write-agents excludes `untrusted`. */
  readonly origin: Origin;
  readonly embedModel: string;
  readonly dim: number;
  /** ≤200-char PII-bounded preview (§7.4); never the raw transcript. */
  readonly preview: string;
  readonly bodyRef?: string;
  readonly createdAt: string;
  readonly score?: number; // cosine similarity on recall
}

export interface RecallQuery {
  readonly text: string;
  readonly collections?: Collection[];
  readonly k?: number; // default 5
  readonly threshold?: number; // default 0.3
  /**
   * Trust floor for the ANN filter (§7.4). Write-agents pass
   * `["owner","internal"]`; read/main may include `untrusted`.
   */
  readonly origins?: Origin[];
}

export interface RememberInput {
  readonly collection: Collection;
  readonly text: string;
  /** Provenance of the source content; min-trust across a mixed turn (§7.4). */
  readonly origin: Origin;
  readonly bodyRef?: string;
}

/**
 * Memory (§7.4). Single external provider (our pgvector store). Recall = one
 * shared query embedding → filtered ANN across collections; remember =
 * fact-gate → extract → per-origin dedupe → upsert. Best-effort: a wedged
 * backend degrades the feature, never blocks a reply (§1.4, §20).
 */
export interface MemoryPort {
  recall(q: RecallQuery): Effect.Effect<MemoryRecord[], MemoryError>;
  remember(inputs: RememberInput[]): Effect.Effect<number, MemoryError>;
  /** Prefetch on the inbound message while the persona assembles (§7.4 lifecycle). */
  prefetch(text: string, origins: Origin[]): Effect.Effect<MemoryRecord[]>;
}

export interface MemoryConfig {
  readonly embedModel: string;
  readonly dim: number;
  readonly defaultK: number; // 5
  readonly threshold: number; // 0.3
  readonly dedupeCosine: number; // 0.95
  readonly previewMax: number; // 200
}

export interface RecallRowsOptions {
  readonly collections: Collection[];
  readonly origins: Origin[];
  readonly k: number;
  readonly vec: string;
}

export interface InsertOptions {
  readonly input: RememberInput;
  readonly hash: string;
  readonly preview: string;
  readonly vec: string;
}

/** A row as stored in the `memory` table (§7.4); mapped to `MemoryRecord` on recall. */
export interface MemoryRow {
  collection: string;
  id: string;
  origin: string;
  embed_model: string;
  dim: number;
  preview: string;
  body_ref: string | null;
  created_at: Date;
  score: string;
}
