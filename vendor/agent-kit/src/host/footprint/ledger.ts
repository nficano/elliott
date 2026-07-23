import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { addScopeFinalizer, repeatAfter } from "../../core/recurring-worker.js";
import type { StorePort } from "../../store/types.js";
import type { Observability } from "../observability/types.js";
import type {
  Agg,
  ComponentReport,
  DynamicSample,
  FootprintLedger,
  StaticFootprint,
} from "./types.js";

const MAX_LATENCY_SAMPLES = 4096;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const P50_PERCENTILE = 50;
const P95_PERCENTILE = 95;
const PERCENTAGE_DENOMINATOR = 100;

/**
 * Footprint ledger (§11). Static (cold) footprint is exact — known at
 * registration. Dynamic footprint is an ESTIMATE, aggregated per component and
 * periodically flushed to the Postgres time series (§27.1) + mirrored to OTel
 * gauges (§12). Cardinality is capped (§11.1): full detail stays in pg; only
 * top-N components go to the metric bus.
 */
export class PgFootprintLedger implements FootprintLedger {
  private readonly statics = new Map<string, StaticFootprint>();
  private readonly aggs = new Map<string, Agg>();
  private workerScope: Scope.Closeable | undefined;

  constructor(
    private readonly store: StorePort,
    private readonly obs: Observability,
    private readonly flushMs = DEFAULT_FLUSH_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    if (this.workerScope) return;
    const scope = await Effect.runPromise(Scope.make());
    this.workerScope = scope;
    try {
      addScopeFinalizer(scope, this.flushEffect());
      await Effect.runPromise(
        Effect.forkIn(repeatAfter(this.flushEffect(), this.flushMs), scope),
      );
    } catch (error) {
      this.workerScope = undefined;
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    }
  }

  async stop(): Promise<void> {
    const scope = this.workerScope;
    this.workerScope = undefined;
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    } else {
      await Effect.runPromise(this.flushEffect());
    }
  }

  recordStatic(f: StaticFootprint): void {
    this.statics.set(f.componentId, f);
    this.obs.gauge("agentkit.footprint.cold_tokens", f.coldTokens, {
      "agentkit.component.id": f.componentId,
    });
  }

  async recordDynamic(s: DynamicSample): Promise<void> {
    const a = this.aggs.get(s.componentId) ?? blankAgg();
    a.calls++;
    if (a.ms.length < MAX_LATENCY_SAMPLES) {
      a.ms.push(s.toolMs);
    } else {
      a.ms[a.msCursor] = s.toolMs;
      a.msCursor = (a.msCursor + 1) % MAX_LATENCY_SAMPLES;
    }
    a.inTok += s.inTokensEst;
    a.outTok += s.outTokensEst;
    a.usd += s.usdEst;
    a.cacheR += s.cacheReadTokens;
    a.cacheW += s.cacheWriteTokens;
    if (s.error) a.errors++;
    this.aggs.set(s.componentId, a);
  }

  exposedColdTokens(componentIds: string[]): number {
    let sum = 0;
    for (const id of componentIds) sum += this.statics.get(id)?.coldTokens ?? 0;
    return sum;
  }

  async report(): Promise<ComponentReport[]> {
    const out: ComponentReport[] = [];
    for (const [id, a] of this.aggs) {
      const cold = this.statics.get(id)?.coldTokens ?? 0;
      const toolMs = percentiles(a.ms, [P50_PERCENTILE, P95_PERCENTILE]);
      out.push({
        componentId: id,
        coldTokens: cold,
        calls: a.calls,
        toolMsP50: toolMs[0]!,
        toolMsP95: toolMs[1]!,
        inTokensEst: a.inTok,
        outTokensEst: a.outTok,
        usdEst: a.usd,
        errorRate: a.calls ? a.errors / a.calls : 0,
        cacheHitRate: a.inTok ? a.cacheR / a.inTok : 0,
      });
    }
    // Components with static cost but no traffic still appear (cold-only).
    for (const [id, f] of this.statics) {
      if (!this.aggs.has(id)) {
        out.push({
          componentId: id,
          coldTokens: f.coldTokens,
          calls: 0,
          toolMsP50: 0,
          toolMsP95: 0,
          inTokensEst: 0,
          outTokensEst: 0,
          usdEst: 0,
          errorRate: 0,
          cacheHitRate: 0,
        });
      }
    }
    return out.sort((x, y) => y.coldTokens - x.coldTokens);
  }

  private async flush(): Promise<void> {
    const rows = await this.report();
    if (rows.length === 0) return;
    try {
      const inserts = rows.filter((row) => row.calls > 0).map((row) => ({
        component_id: row.componentId,
        cold_tokens: row.coldTokens,
        calls: row.calls,
        tool_ms_p50: row.toolMsP50,
        tool_ms_p95: row.toolMsP95,
        in_tokens_est: row.inTokensEst,
        out_tokens_est: row.outTokensEst,
        usd_est: row.usdEst,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        error_count: Math.round(row.errorRate * row.calls),
      }));
      if (inserts.length > 0) {
        const sql = this.store.sql;
        await this.store.run(
          sql`INSERT INTO footprint_ledger ${sql.insert(inserts)}`,
        );
      }
      this.aggs.clear();
    } catch {
      /* best-effort — never block on the ledger (§1.4) */
    }
  }

  private readonly flushEffect = Effect.fn("PgFootprintLedger.flush")(
    { self: this },
    function*(this: PgFootprintLedger) {
      yield* Effect.promise(() => this.flush()).pipe(Effect.uninterruptible);
    },
  );
}

function blankAgg(): Agg {
  return {
    calls: 0,
    ms: [],
    msCursor: 0,
    inTok: 0,
    outTok: 0,
    usd: 0,
    cacheR: 0,
    cacheW: 0,
    errors: 0,
  };
}

function percentiles(xs: number[], values: readonly number[]): number[] {
  if (xs.length === 0) return values.map(() => 0);
  const sorted = [...xs].sort((a, b) => a - b);
  return values.map((value) => {
    const index = Math.min(
      sorted.length - 1,
      Math.floor((value / PERCENTAGE_DENOMINATOR) * sorted.length),
    );
    return Math.round(sorted[index]!);
  });
}
