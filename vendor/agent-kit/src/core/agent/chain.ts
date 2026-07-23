/**
 * Call-chain tracing (CAPABILITIES-TDD §8) — the run-graph analog of GitHub's
 * reusable-workflow chain. Every nested invocation (turn → tool → capability →
 * provider → …) appends a hop; the chain rides spans (`agentkit.chain`) and is
 * embedded in every capability error, so a failure reads as a path. Hops carry
 * refs and notes only — never payloads (§12 content-free telemetry).
 */
import type { CallChain, Hop, HopKind } from "./types.js";

/** Capability-nesting cap — GitHub's 4-level reusable-workflow limit, same rationale. */
export const MAX_CAPABILITY_DEPTH = 4;
const DEFAULT_CHAIN_MAX_CHARS = 512;

export function pushHop(chain: CallChain, hop: Hop): CallChain {
  return [...chain, hop];
}

export function capabilityDepth(chain: CallChain): number {
  return chain.filter((h) => h.kind === "capability").length;
}

/** True when the chain already holds this exact hop — the cycle check. */
export function hasHop(chain: CallChain, kind: HopKind, ref: string): boolean {
  return chain.some((h) => h.kind === kind && h.ref === ref);
}

/** `turn:main → tool:watch_snapshot → capability:metric-rows@1`, bounded. */
export function formatChain(
  chain: CallChain,
  maxChars = DEFAULT_CHAIN_MAX_CHARS,
): string {
  const s = chain.map((h) => `${h.kind}:${h.ref}`).join(" → ");
  return s.length <= maxChars ? s : `…${s.slice(s.length - maxChars + 1)}`;
}
