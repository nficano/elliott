import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { StorePort } from "../../store/types.js";
import { MemoryError } from "../errors.js";
import type { LlmPort } from "../llm/types.js";
import { type Origin } from "../types.js";
import { MemoryRowSchema } from "./schema.js";
import type {
  Collection,
  InsertOptions,
  MemoryConfig,
  MemoryPort,
  MemoryRecord,
  RecallQuery,
  RecallRowsOptions,
  RememberInput,
} from "./types.js";

const ALL_COLLECTIONS: Collection[] = [
  "episodic",
  "semantic",
  "learnings",
  "inner",
];
const ALL_ORIGINS: Origin[] = ["owner", "internal", "untrusted"];
const FACT_MIN_CHARS = 20;
const FACT_MAX_CHARS = 4000;
const SHORT_QUESTION_MAX_CHARS = 80;
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const HEX_RADIX = 16;

/**
 * Memory (§7.4). Recall = one shared query embedding → FILTERED ANN across
 * collections; remember = fact-gate → extract → per-origin dedupe → upsert.
 * Provenance is load-bearing: write-agent recall passes `origins:[owner,internal]`
 * so an injected "fact" can't resurface as trusted context. Dedupe runs WITHIN
 * an origin, never across (an owner restatement writes a new owner row — an
 * upgrade — it doesn't merge into the untrusted one). Best-effort throughout: a
 * wedged backend degrades the feature, never blocks a reply.
 */
export class PgMemory implements MemoryPort {
  constructor(
    private readonly store: StorePort,
    private readonly llm: LlmPort,
    private readonly cfg: MemoryConfig,
  ) {}

  readonly recall = Effect.fn("PgMemory.recall")(
    { self: this },
    function*(
      this: PgMemory,
      q: RecallQuery,
    ): Effect.fn.Return<MemoryRecord[], MemoryError> {
      const collections = q.collections ?? ALL_COLLECTIONS;
      const origins = q.origins ?? ALL_ORIGINS;
      const k = q.k ?? this.cfg.defaultK;
      const threshold = q.threshold ?? this.cfg.threshold;
      const emb = yield* this.embed(q.text);
      if (!emb) return [];
      const rows = yield* this.recallRows({
        collections,
        origins,
        k,
        vec: toVectorLiteral(emb),
      });
      return rows
        .filter((row) => Number(row.score) >= threshold)
        .map((row) => toRecord(row));
    },
  );

  private recallRows(
    options: RecallRowsOptions,
  ): Effect.Effect<readonly (typeof MemoryRowSchema.Type)[], MemoryError> {
    const { collections, origins, k, vec } = options;
    const sql = this.store.sql;
    return sql.withTransaction(
      // Filtered ANN needs iterative_scan or the origin filter silently returns
      // too few rows (§7.4). SET LOCAL scopes it to this transaction only.
      Effect.gen(function*() {
        yield* sql`SET LOCAL hnsw.iterative_scan = relaxed_order`.pipe(
          Effect.catch(() => Effect.void),
        );
        const rows = yield* sql`
          SELECT collection, id, origin, embed_model, dim, preview, body_ref,
                 created_at, 1 - (embedding <=> ${vec}::vector) AS score
          FROM memory
          WHERE collection = ANY(${collections}) AND origin = ANY(${origins})
          ORDER BY embedding <=> ${vec}::vector
          LIMIT ${k}
        `;
        return yield* Schema.decodeUnknownEffect(
          Schema.Array(MemoryRowSchema),
        )(rows);
      }),
    ).pipe(
      Effect.mapError((cause) =>
        new MemoryError({ message: "recall failed", cause })
      ),
    );
  }

  readonly remember = Effect.fn("PgMemory.remember")(
    { self: this },
    function*(
      this: PgMemory,
      inputs: RememberInput[],
    ): Effect.fn.Return<number, MemoryError> {
      const candidates = inputs.filter((input) => looksFactBearing(input.text));
      if (candidates.length === 0) return 0;
      const embeddings = yield* this.embedMany(
        candidates.map((input) => input.text),
      );
      if (!embeddings) return 0;

      let written = 0;
      for (const [index, input] of candidates.entries()) {
        const emb = embeddings[index];
        if (!emb) continue;
        const hash = contentHash(input.text);
        const preview = input.text.slice(0, this.cfg.previewMax);
        const vec = toVectorLiteral(emb);
        if (yield* this.isDuplicate(input, hash, vec)) continue;
        yield* this.insert({ input, hash, preview, vec });
        written++;
      }
      return written;
    },
  );

  private insert(options: InsertOptions): Effect.Effect<void, MemoryError> {
    const { input, hash, preview, vec } = options;
    const sql = this.store.sql;
    return sql`
      INSERT INTO memory (collection, origin, embed_model, dim, embedding, preview, body_ref, content_hash)
      VALUES (${input.collection}, ${input.origin}, ${this.cfg.embedModel}, ${this.cfg.dim},
              ${vec}::vector, ${preview}, ${input.bodyRef ?? null}, ${hash})
    `
      .pipe(
        Effect.asVoid,
        Effect.mapError((cause) =>
          new MemoryError({ message: "remember failed", cause })
        ),
      );
  }

  private isDuplicate(
    input: RememberInput,
    hash: string,
    vec: string,
  ): Effect.Effect<boolean, MemoryError> {
    const sql = this.store.sql;
    const dedupeCosine = this.cfg.dedupeCosine;
    return Effect.gen(function*() {
      const exact = yield* sql<{ found: boolean; }>`
        SELECT EXISTS(
          SELECT 1 FROM memory
          WHERE collection = ${input.collection} AND origin = ${input.origin}
            AND content_hash = ${hash}
        ) AS found
      `;
      if (exact[0]?.found) return true;

      const nearest = yield* sql.withTransaction(
        Effect.gen(function*() {
          yield* sql`SET LOCAL hnsw.iterative_scan = relaxed_order`.pipe(
            Effect.catch(() => Effect.void),
          );
          return yield* sql<{ score: string | number; }>`
            SELECT 1 - (embedding <=> ${vec}::vector) AS score
            FROM memory
            WHERE collection = ${input.collection} AND origin = ${input.origin}
            ORDER BY embedding <=> ${vec}::vector
            LIMIT 1
          `;
        }),
      );
      return Number(nearest[0]?.score ?? -1) >= dedupeCosine;
    }).pipe(
      Effect.mapError((cause) =>
        new MemoryError({ message: "remember failed", cause })
      ),
    );
  }

  readonly prefetch = Effect.fn("PgMemory.prefetch")(
    { self: this },
    function*(
      this: PgMemory,
      text: string,
      origins: Origin[],
    ): Effect.fn.Return<MemoryRecord[]> {
      return yield* this.recall({ text, origins }).pipe(
        Effect.match({
          onFailure: () => [],
          onSuccess: (records) => records,
        }),
      );
    },
  );

  private embed(
    text: string,
  ): Effect.Effect<number[] | undefined> {
    return Effect.result(
      this.llm.embed({ input: text, model: this.cfg.embedModel }),
    ).pipe(
      Effect.map((result) =>
        Result.isSuccess(result) ? result.success.vectors[0] : undefined
      ),
    );
  }

  private embedMany(
    texts: string[],
  ): Effect.Effect<number[][] | undefined> {
    return Effect.result(
      this.llm.embed({ input: texts, model: this.cfg.embedModel }),
    ).pipe(
      Effect.map((result) =>
        Result.isSuccess(result) ? result.success.vectors : undefined
      ),
    );
  }
}

function toRecord(r: typeof MemoryRowSchema.Type): MemoryRecord {
  const rec: MemoryRecord = {
    id: r.id,
    collection: r.collection,
    origin: r.origin,
    embedModel: r.embed_model,
    dim: r.dim,
    preview: r.preview,
    createdAt: r.created_at.toISOString(),
    score: Number(r.score),
  };
  return r.body_ref ? { ...rec, bodyRef: r.body_ref } : rec;
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Cheap fact-bearing gate (§7.4): skip greetings/questions/very short or long text. */
function looksFactBearing(text: string): boolean {
  const t = text.trim();
  if (t.length < FACT_MIN_CHARS || t.length > FACT_MAX_CHARS) return false;
  if (/^\s*(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure)\b/i.test(t)) {
    return false;
  }
  if (t.endsWith("?") && t.length < SHORT_QUESTION_MAX_CHARS) return false;
  return true;
}

function contentHash(text: string): string {
  const norm = text.trim().toLowerCase().replaceAll(/\s+/g, " ");
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(HEX_RADIX);
}
