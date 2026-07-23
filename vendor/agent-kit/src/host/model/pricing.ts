import { type ModelChoice, type Usage } from "../../core/types.js";
import type { Price } from "./types.js";

/**
 * Rough per-token pricing for the per-turn budget guard (§11). Deliberately
 * approximate — the authoritative cost is Langfuse's per-model pricing (§12.2);
 * this only needs to be good enough to trip the per-turn cap (§20). USD per token.
 */
const PRICES: { match: string; price: Price; }[] = [
  { match: "opus", price: { in: 15e-6, out: 75e-6, cacheRead: 1.5e-6 } },
  { match: "sonnet", price: { in: 3e-6, out: 15e-6, cacheRead: 0.3e-6 } },
  { match: "haiku", price: { in: 0.8e-6, out: 4e-6, cacheRead: 0.08e-6 } },
  { match: "gpt", price: { in: 2.5e-6, out: 10e-6, cacheRead: 0.25e-6 } },
];
const LOCAL: Price = { in: 0, out: 0, cacheRead: 0 }; // tier-local (Ollama) is $0

export function estimateCost(model: ModelChoice, usage: Usage): number {
  const name = model.model.toLowerCase();
  if (name.includes("tier-local") || name.includes("ollama")) return 0;
  const entry = PRICES.find((p) => name.includes(p.match));
  const price = entry?.price ?? LOCAL;
  const billedInput = Math.max(0, usage.input - usage.cacheRead);
  return billedInput * price.in + usage.output * price.out
    + usage.cacheRead * price.cacheRead;
}
