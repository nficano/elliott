import * as Redacted from "effect/Redacted";
import type { LangfuseConfig, TurnScore } from "./types.js";

/**
 * Langfuse scoring client (§12.2). Traces/generations reach Langfuse via the one
 * OTel pipeline (collector fan-out) — prompts are git-authoritative, NOT fetched
 * from Langfuse. This client is only for the things OTLP doesn't carry: per-turn
 * SCORES (heuristic + judge, §13 signals) and dataset/annotation items. Content
 * still flows through the PII-boundaried path, never the metric bus (§12.1).
 */
export class LangfuseScores {
  private readonly auth: string;
  constructor(private readonly cfg: LangfuseConfig) {
    this.auth = "Basic "
      + Buffer.from(`${cfg.publicKey}:${Redacted.value(cfg.secretKey)}`)
        .toString("base64");
  }

  /** POST a score for a turn's trace. Best-effort — never blocks the turn (§1.4). */
  async score(s: TurnScore): Promise<void> {
    try {
      await fetch(`${this.cfg.host}/api/public/scores`, {
        method: "POST",
        headers: {
          authorization: this.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          traceId: s.traceId,
          name: s.name,
          value: s.value,
          ...(s.comment && { comment: s.comment }),
        }),
      });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Heuristic per-turn scores (§13): rounds-exhausted, retries, gate-fires,
 * latency, cost, corrections. LLM-as-judge scores are added by the consumer's
 * evaluators (§12.2). These feed the self-improvement signals (§13).
 */
export function heuristicScores(turn: {
  traceId: string;
  roundsExhausted: boolean;
  toolCalls: number;
  costUsd: number;
  totalMs: number;
}): TurnScore[] {
  return [
    {
      traceId: turn.traceId,
      name: "rounds_exhausted",
      value: turn.roundsExhausted ? 1 : 0,
    },
    { traceId: turn.traceId, name: "tool_calls", value: turn.toolCalls },
    { traceId: turn.traceId, name: "cost_usd", value: turn.costUsd },
    { traceId: turn.traceId, name: "latency_ms", value: turn.totalMs },
  ];
}
