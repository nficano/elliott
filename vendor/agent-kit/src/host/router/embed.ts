/**
 * Static in-process embeddings for tool/bundle ranking (§10.1). The router runs
 * OFF the network critical path — embedding a turn via LiteLLM would add a full
 * RTT to TTFT (~30–80 ms), dwarfing the 10 ms deltas §11 exists to detect. This
 * is a dependency-free hashing embedder (word + char-3gram → signed hashed bag →
 * L2-normalized). Swappable for model2vec/fastembed if recall demands it; the
 * interface is what matters.
 */
const DIM = 256;
const HASH_SIGN_BIT_SHIFT = 31;
const CHARACTER_NGRAM_SIZE = 3;
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

export class StaticEmbedder {
  readonly dim = DIM;

  embed(text: string): Float32Array {
    const v = new Float32Array(DIM);
    for (const tok of tokens(text)) {
      const h = hash(tok);
      const idx = h % DIM;
      const sign = (h >>> HASH_SIGN_BIT_SHIFT) & 1 ? -1 : 1;
      v[idx]! += sign;
    }
    normalize(v);
    return v;
  }

  cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += a[i]! * b[i]!;
    return dot; // both are L2-normalized
  }
}

function* tokens(text: string): Generator<string> {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    yield w;
    // char 3-grams give partial-match recall (e.g. "playlist" ~ "playlists").
    for (let i = 0; i + CHARACTER_NGRAM_SIZE <= w.length; i++) {
      yield `#${w.slice(i, i + CHARACTER_NGRAM_SIZE)}`;
    }
  }
}

function hash(s: string): number {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function normalize(v: Float32Array): void {
  let mag = 0;
  for (let i = 0; i < v.length; i++) mag += v[i]! * v[i]!;
  mag = Math.sqrt(mag);
  if (mag === 0) return;
  for (let i = 0; i < v.length; i++) v[i]! /= mag;
}
