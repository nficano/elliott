/**
 * Per-provider cached-token accounting (§11/§27.5). Providers report cache usage
 * under different field names — Anthropic `cache_read_input_tokens` /
 * `cache_creation_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens` —
 * and LiteLLM's normalization has been inconsistent. Without an explicit mapping
 * the cache-hit-rate metric is quietly wrong for one provider. This checks all
 * known locations, keyed by the response model's provider prefix.
 */
import { type Usage } from "../types.js";
import type { RawUsage } from "./types.js";

export function mapUsage(raw: RawUsage | null | undefined): Usage {
  const u = raw ?? {};
  const input = u.prompt_tokens ?? 0;
  const output = u.completion_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens
    ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const total = u.total_tokens ?? input + output;
  return { input, output, cacheRead, cacheWrite, total };
}
