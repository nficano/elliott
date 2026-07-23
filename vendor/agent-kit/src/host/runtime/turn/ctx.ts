import type { ToolCtx } from "../../../core/agent/types.js";
import type { BuildTurnCtxParams, TurnCtx } from "../types.js";

/**
 * Build the per-turn context (§4). The config snapshot is captured here at turn
 * start, so a mid-turn `/config/reload` can't change this turn's behavior (§5
 * hot-reload safety).
 */
export function buildTurnCtx(p: BuildTurnCtxParams): TurnCtx {
  return {
    traceId: p.traceId,
    sessionId: p.conversationKey, // rotated on compaction (§10.4)
    conversationKey: p.conversationKey,
    config: p.config,
    agentId: p.agentId,
    origin: p.origin,
    tier: p.tier,
    profile: p.profile,
    bundles: [],
    budget: p.budget,
    steering: p.steering,
    signal: p.signal,
  };
}

/** Derive the tool-execution context from a turn context. */
export function toolCtxFrom(t: TurnCtx): ToolCtx {
  return {
    traceId: t.traceId,
    sessionId: t.sessionId,
    conversationKey: t.conversationKey,
    origin: t.origin,
    signal: t.signal,
    steer: (text: string) => t.steering.push(text),
  };
}
