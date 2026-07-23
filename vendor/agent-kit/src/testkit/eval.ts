import type { GoldenItem, RunDelta, RunFn, RunMetrics } from "./types.js";

const PERCENTILE_50 = 50;
const PERCENTILE_95 = 95;
const PERCENT_SCALE = 100;
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const UINT32_MAX = 0xFF_FF_FF_FF;

/**
 * Eval harness (§11.2) — the paid, nightly, non-deterministic gate (distinct
 * from the free static footprint gate). Replays a golden dataset enabled-vs-
 * disabled to produce Δp50/Δp95 TTFT, Δtotal, Δcost, Δquality. Runs through the
 * Batch API in CI (latency-irrelevant, half price). Datasets are supplied by the
 * consumer (§24).
 */
export async function runDataset(
  items: GoldenItem[],
  run: RunFn,
): Promise<RunMetrics[]> {
  const out: RunMetrics[] = [];
  for (const item of items) {
    out.push({ id: item.id, ...(await run(item.input)) });
  }
  return out;
}

/** Compare a baseline run to a variant run (e.g. component enabled vs disabled). */
export function compareRuns(
  baseline: RunMetrics[],
  variant: RunMetrics[],
): RunDelta {
  const bTtft = baseline.map((r) => r.ttftMs);
  const vTtft = variant.map((r) => r.ttftMs);
  return {
    dP50Ms: percentile(vTtft, PERCENTILE_50)
      - percentile(bTtft, PERCENTILE_50),
    dP95Ms: percentile(vTtft, PERCENTILE_95)
      - percentile(bTtft, PERCENTILE_95),
    dTotalMs: mean(variant.map((r) => r.totalMs))
      - mean(baseline.map((r) => r.totalMs)),
    dCostUsd: mean(variant.map((r) => r.costUsd))
      - mean(baseline.map((r) => r.costUsd)),
    dQuality: mean(variant.map((r) => r.quality ?? 0))
      - mean(baseline.map((r) => r.quality ?? 0)),
  };
}

/**
 * Degradation testing (§11.2, adapt hermes's toolset sampling — EVAL-ONLY).
 * Randomly sample a tool subset to test behavior when tools are missing. Never
 * in the runtime — probabilistic tool availability in production is
 * non-determinism users don't want. `seed` keeps a run reproducible (no
 * Math.random in shipped paths).
 */
export function sampleToolSubset<T>(
  tools: T[],
  keepFraction: number,
  seed: number,
): T[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return s / UINT32_MAX;
  };
  return tools.filter(() => rnd() < keepFraction);
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.floor((p / PERCENT_SCALE) * sorted.length),
    )
  ]!;
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
