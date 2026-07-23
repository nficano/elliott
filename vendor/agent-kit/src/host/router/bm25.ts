/**
 * Tiny in-process BM25 (§10.1). Rebuilt statelessly per query over the live
 * candidate set — never a session-keyed cache (that's the OpenClaw "catalog
 * drifts → silent tool dropouts" regression we avoid). A substring fallback
 * covers zero-IDF queries (`github` when every tool is `github_*`).
 */
import type { Bm25Index, Doc } from "./types.js";

export type { Bm25Index } from "./types.js";

const K1 = 1.5;
const B = 0.75;
const SUBSTRING_FALLBACK_SCORE = 0.1;
const IDF_SMOOTHING = 0.5;
const DEFAULT_RRF_RANK_CONSTANT = 60;

export function buildBm25Index(docs: readonly Doc[]): Bm25Index {
  const tokenized = docs.map((d) => ({
    id: d.id,
    toks: terms(d.text),
    raw: d.text.toLowerCase(),
    tf: new Map<string, number>(),
  }));
  for (const doc of tokenized) {
    for (const token of doc.toks) {
      doc.tf.set(token, (doc.tf.get(token) ?? 0) + 1);
    }
  }
  const avgLen = tokenized.reduce((n, d) => n + d.toks.length, 0)
    / (tokenized.length || 1);
  const df = new Map<string, number>();
  for (const d of tokenized) {
    for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { docs: tokenized, avgLen, df };
}

export function rankBm25(
  query: string,
  index: Bm25Index,
): { id: string; score: number; }[] {
  const qTerms = terms(query);
  const N = index.docs.length;
  const scored = index.docs.map((d) => {
    let score = 0;
    for (const qt of qTerms) {
      const f = d.tf.get(qt) ?? 0;
      if (f === 0) {
        // zero-IDF substring fallback
        if (d.raw.includes(qt)) score += SUBSTRING_FALLBACK_SCORE;
        continue;
      }
      const idf = Math.log(
        1
          + (N - (index.df.get(qt) ?? 0) + IDF_SMOOTHING)
            / ((index.df.get(qt) ?? 0) + IDF_SMOOTHING),
      );
      const denom = f
        + K1 * (1 - B + (B * d.toks.length) / index.avgLen);
      score += idf * ((f * (K1 + 1)) / denom);
    }
    return { id: d.id, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export function bm25Rank(
  query: string,
  docs: readonly Doc[],
): { id: string; score: number; }[] {
  return rankBm25(query, buildBm25Index(docs));
}

/** Reciprocal-rank fusion of N ranked id-lists (§10.1). */
export function rrf(
  lists: { id: string; score: number; }[][],
  k = DEFAULT_RRF_RANK_CONSTANT,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    for (const [rank, item] of list.entries()) {
      fused.set(item.id, (fused.get(item.id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return fused;
}

function terms(text: string): string[] {
  // Split snake/dot/kebab into words too (§10.1 search blob).
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
