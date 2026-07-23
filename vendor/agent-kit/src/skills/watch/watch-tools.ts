import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { pushHop } from "../../core/agent/chain.js";
import { define } from "../../core/agent/index.js";
import type { CallChain, ToolDef } from "../../core/agent/types.js";
import { degradeForModel } from "../../host/capabilities/bus.js";
import type { CapabilityInvoker } from "../../host/capabilities/types.js";
import { aggregateBySubject, aggregateFor } from "./aggregates.js";
import { diffSnapshots } from "./diff.js";
import { measureOutcomes, recordOutcome } from "./outcomes.js";
import { decaying, splitAttribution } from "./trend.js";
import type { Cfg, ToolRuntime, WatchRow, WatchStore } from "./types.js";
import {
  aggregateOptions,
  decayOptions,
  diffOptions,
  isoDay,
  splitOptions,
} from "./watch-options.js";

const KEY = "watch";
const MIN_TREND_SNAPSHOTS = 3;

const meta = {
  componentId: "watch",
  bundle: "ops",
  core: false,
  write: false,
};

export function createWatchTools(params: {
  readonly cfg: Cfg;
  readonly store: WatchStore;
  readonly now: () => Date;
  readonly caps?: CapabilityInvoker;
}): ToolDef[] {
  const runtime: ToolRuntime = {
    cfg: params.cfg,
    store: params.store,
    now: params.now,
    pullRows: makePullRows(params.cfg, params.caps),
  };
  return [
    makeSnapshotTool(runtime),
    makeTrendsTool(runtime),
    makeOutcomeRecordTool(runtime),
    makeOutcomesTool(runtime),
  ];
}

function makePullRows(
  cfg: Cfg,
  caps?: CapabilityInvoker,
): ToolRuntime["pullRows"] {
  return async (toolName, toolCtx) => {
    if (!caps) return { error: "capability bus unavailable" };
    const chain: CallChain = pushHop(toolCtx.chain ?? [], {
      kind: "tool",
      ref: toolName,
    });
    const result = await Effect.runPromise(Effect.result(caps.invoke(
      "metric-rows@1",
      { days: cfg.days },
      { chain, origin: toolCtx.origin },
    )));
    if (Result.isFailure(result)) {
      return { error: degradeForModel(result.failure) };
    }
    return result.success as { rows: WatchRow[]; };
  };
}

function makeSnapshotTool(runtime: ToolRuntime): ToolDef {
  return define({
    name: "watch_snapshot",
    description:
      "Snapshot the watched metric surface and diff it against the previous snapshot: "
      + "improved/declined/entered/exited plus the act-now subset. First run seeds the "
      + "baseline. State the compared-to date when narrating — day-scale wobble is not a trend.",
    schema: Schema.Struct({}),
    meta,
    run: async (_args, toolCtx) => {
      const pulled = await runtime.pullRows("watch_snapshot", toolCtx);
      if ("error" in pulled) return pulled.error;
      const date = isoDay(runtime.now);
      const snapshot = { date, rows: pulled.rows };
      const previous = await runtime.store.previous(KEY, date);
      await runtime.store.save(KEY, snapshot);
      if (!previous) {
        return JSON.stringify({
          baseline: true,
          date,
          rows: pulled.rows.length,
        });
      }
      const diff = diffSnapshots(snapshot, previous, diffOptions(runtime.cfg));
      return JSON.stringify({
        date,
        comparedTo: previous.date,
        rows: pulled.rows.length,
        ...diff,
      });
    },
  });
}

function makeTrendsTool(runtime: ToolRuntime): ToolDef {
  return define({
    name: "watch_trends",
    description:
      "Long-horizon signals over the snapshot history: decaying series (quiet erosion amid "
      + "real activity) and split attribution (one id served by multiple series). Use after "
      + "several snapshots exist; not for day-over-day moves (use watch_snapshot).",
    schema: Schema.Struct({}),
    meta,
    run: async () => {
      const date = isoDay(runtime.now);
      const history = await runtime.store.history(
        KEY,
        date,
        runtime.cfg.history_limit,
      );
      if (history.length < MIN_TREND_SNAPSHOTS) {
        return JSON.stringify({
          note:
            `need ≥${MIN_TREND_SNAPSHOTS} snapshots, have ${history.length}`,
        });
      }
      const latest = history.at(-1)!;
      return JSON.stringify({
        snapshots: history.length,
        decaying: decaying(history, decayOptions(runtime.cfg)),
        splitAttribution: runtime.cfg.activity_metric
          ? splitAttribution(latest.rows, splitOptions(runtime.cfg))
          : [],
      });
    },
  });
}

function makeOutcomeRecordTool(runtime: ToolRuntime): ToolDef {
  return define({
    name: "watch_outcome_record",
    description:
      "Record a baseline for a shipped change so its effect is measurable later. Call the "
      + "moment a change ships (pair with every proposal), naming what changed and the id or "
      + "series it targeted.",
    schema: Schema.Struct({
      kind: Schema.String,
      subject: Schema.String,
      note: Schema.optional(Schema.String),
      ref: Schema.optional(Schema.String),
    }),
    meta,
    run: async (args, toolCtx) => {
      const pulled = await runtime.pullRows("watch_outcome_record", toolCtx);
      if ("error" in pulled) return pulled.error;
      const baseline = aggregateFor(
        pulled.rows,
        args.subject,
        aggregateOptions(runtime.cfg),
      );
      if (!baseline) {
        return JSON.stringify({
          error: `no rows match subject '${args.subject}'`,
        });
      }
      const ledger = await runtime.store.loadLedger(KEY);
      const next = recordOutcome(ledger, {
        kind: args.kind,
        subject: args.subject,
        baseline,
        ...((args.note !== undefined) && { note: args.note }),
        ...((args.ref !== undefined) && { ref: args.ref }),
        now: runtime.now(),
      });
      await runtime.store.saveLedger(KEY, next);
      return JSON.stringify({
        recorded: true,
        subject: args.subject,
        baseline,
      });
    },
  });
}

function makeOutcomesTool(runtime: ToolRuntime): ToolDef {
  return define({
    name: "watch_outcomes",
    description:
      "Verdicts for recorded changes past their soak window (improved/declined/flat/no-data), "
      + "plus what's still soaking. The feedback loop — check before proposing more of the same.",
    schema: Schema.Struct({}),
    meta,
    run: async (_args, toolCtx) => {
      const ledger = await runtime.store.loadLedger(KEY);
      if (ledger.length === 0) {
        return JSON.stringify({ note: "no recorded outcomes yet" });
      }
      const pulled = await runtime.pullRows("watch_outcomes", toolCtx);
      if ("error" in pulled) return pulled.error;
      const aggregates = aggregateBySubject(
        pulled.rows,
        aggregateOptions(runtime.cfg),
      );
      const report = await measureOutcomes(
        ledger,
        async (record) => aggregates.get(record.subject) ?? null,
        {
          metric: runtime.cfg.metric,
          direction: runtime.cfg.direction,
          ...(runtime.cfg.activity_metric
            && { activityMetric: runtime.cfg.activity_metric }),
          soakDays: runtime.cfg.soak_days,
          retireDays: runtime.cfg.retire_days,
          now: runtime.now(),
        },
      );
      return JSON.stringify(report);
    },
  });
}
