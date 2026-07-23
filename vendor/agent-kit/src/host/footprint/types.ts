/**
 * Footprint accounting (§11) — the marquee feature. Static (cold) footprint is
 * known at registration; dynamic footprint is an *estimate* apportioned by
 * tool-output byte share (§11.1). "This MCP added N cold tokens and ~10 ms p50"
 * is a number the system produces.
 */

export interface StaticFootprint {
  readonly componentId: string;
  readonly schemaTokens: number;
  readonly promptTokens: number;
  readonly coldTokens: number; // schema + prompt (relative units, §11.1)
  readonly initMs?: number;
}

export interface DynamicSample {
  readonly componentId: string;
  readonly toolMs: number;
  readonly inTokensEst: number;
  readonly outTokensEst: number;
  readonly usdEst: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly error: boolean;
}

export interface ComponentReport {
  readonly componentId: string;
  readonly coldTokens: number;
  readonly calls: number;
  readonly toolMsP50: number;
  readonly toolMsP95: number;
  readonly inTokensEst: number;
  readonly outTokensEst: number;
  readonly usdEst: number;
  readonly errorRate: number;
  readonly cacheHitRate: number;
}

export interface FootprintLedger {
  /** Record a component's static cost at registration/connect (§11.1). */
  recordStatic(f: StaticFootprint): void;
  /** Record a per-call dynamic estimate, attributed via spans (§11.1). */
  recordDynamic(s: DynamicSample): Promise<void>;
  /** Aggregate report for `GET /footprint` (§11). */
  report(sinceIso?: string): Promise<ComponentReport[]>;
  /** Sum of exposed cold tokens — enforced against budgets.cold_tokens_max (§11). */
  exposedColdTokens(componentIds: string[]): number;
}

export interface Agg {
  calls: number;
  ms: number[];
  msCursor: number;
  inTok: number;
  outTok: number;
  usd: number;
  cacheR: number;
  cacheW: number;
  errors: number;
}
