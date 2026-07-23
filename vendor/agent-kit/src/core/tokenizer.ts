/**
 * Local cold-token counting (§11.1). A *local* tokenizer, never a network call
 * to LiteLLM `/utils/token_counter`, cached by content hash so an unchanged
 * schema is never recounted.
 *
 * Caveat baked into the API (§11.1): `gpt-tokenizer` is OpenAI BPE; Anthropic
 * tokenization differs 10–20%. That's fine for DELTAS (a consistent bias
 * cancels) but wrong for ABSOLUTE budgets — so callers treat these counts as
 * *relative units* for ranking/regression and apply a per-provider calibration
 * factor (measured once at boot) before enforcing `budgets.cold_tokens_max`.
 */
import { countTokens as countBpeTokens } from "gpt-tokenizer";

const CACHE_MAX = 2048;
const DJB2_INITIAL_HASH = 5381;
const DJB2_SHIFT_BITS = 5;
const APPROXIMATE_CHARS_PER_TOKEN = 4;
const cache = new Map<string, number>();

/** djb2 — cheap content key so we don't hold the source strings alive. */
function keyOf(s: string): string {
  let h = DJB2_INITIAL_HASH;
  for (let i = 0; i < s.length; i++) {
    h = ((h << DJB2_SHIFT_BITS) + h + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h >>> 0}`;
}

/** Token count in OpenAI-BPE relative units, memoized by content hash. */
export function countTokens(text: string): number {
  const k = keyOf(text);
  const hit = cache.get(k);
  if (hit !== undefined) {
    cache.delete(k);
    cache.set(k, hit);
    return hit;
  }
  let n: number;
  try {
    n = countBpeTokens(text);
  } catch {
    // Never let tokenization throw into a hot path — approximate on failure.
    n = Math.ceil(text.length / APPROXIMATE_CHARS_PER_TOKEN);
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, n);
  return n;
}

/**
 * Per-provider calibration (§11.1 / §27.5). Compare the local count of a known
 * prefix against the provider's real `usage.input_tokens` once at boot; the
 * factor converts relative units → provider-absolute for budget enforcement.
 */
export class TokenCalibration {
  private factors = new Map<string, number>();

  set(providerPrefix: string, localCount: number, providerCount: number): void {
    if (localCount > 0) {
      this.factors.set(providerPrefix, providerCount / localCount);
    }
  }

  /** Convert a relative count to provider-absolute; 1.0 until calibrated. */
  absolute(providerPrefix: string, relative: number): number {
    return Math.round(relative * (this.factors.get(providerPrefix) ?? 1));
  }

  providerOf(model: string): string {
    const slash = model.indexOf("/");
    return slash === -1 ? model : model.slice(0, slash);
  }
}
