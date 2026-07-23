import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { pushHop } from "../../../core/agent/chain.js";
import type { ToolCtx } from "../../../core/agent/types.js";
import { degradeForModel } from "../../../host/capabilities/bus.js";
import type { CapabilityInvoker } from "../../../host/capabilities/types.js";
import { makeCooldown, makeSeenSet } from "../hygiene.js";
import { isSelfReference } from "../self-guard.js";
import { correlateChange, markSeen, selectSpikes } from "../spike.js";
import type { Cfg, ChangeEvent, FeedItem, SpikeRuntime } from "../types.js";

const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MILLISECONDS_PER_HOUR;
const CHANGE_FEED_LIMIT = 10;

export function createSpikeChecker(params: {
  readonly cfg: Cfg;
  readonly caps?: CapabilityInvoker;
  readonly now: () => number;
}): (toolCtx: ToolCtx) => Promise<string> {
  const runtime: SpikeRuntime = {
    cfg: params.cfg,
    ...(params.caps && { caps: params.caps }),
    seen: makeSeenSet({
      ttlMs: DAYS_PER_WEEK * MILLISECONDS_PER_DAY,
      now: params.now,
    }),
    cooldown: makeCooldown({
      windowMs: params.cfg.cooldown_hours * MILLISECONDS_PER_HOUR,
      now: params.now,
    }),
    selfIdentity: makeSelfIdentity(params.cfg),
    isBaselineSeeded: false,
  };
  return (toolCtx) => runSpikeCheck(runtime, toolCtx);
}

async function runSpikeCheck(
  runtime: SpikeRuntime,
  toolCtx: ToolCtx,
): Promise<string> {
  if (!runtime.caps) {
    return JSON.stringify({ error: "capability bus unavailable" });
  }
  const chain = pushHop(toolCtx.chain ?? [], {
    kind: "tool",
    ref: "spike_check",
  });
  const fetched = await fetchIssues({
    caps: runtime.caps,
    cfg: runtime.cfg,
    toolCtx,
    chain,
  });
  if (typeof fetched === "string") return fetched;
  if (fetched === null) return skippedResult();
  if (!runtime.isBaselineSeeded) {
    markSeen(fetched, { minCount: runtime.cfg.min_count, seen: runtime.seen });
    runtime.isBaselineSeeded = true;
    return baselineResult();
  }
  runtime.seen.prune();
  runtime.cooldown.prune();
  const spikes = selectFresh({
    items: fetched,
    cfg: runtime.cfg,
    seen: runtime.seen,
    cooldown: runtime.cooldown,
    selfIdentity: runtime.selfIdentity,
  });
  const changes = await fetchChanges({
    caps: runtime.caps,
    toolCtx,
    chain,
    spikes,
  });
  return JSON.stringify({
    fresh: spikes.map((spike) => ({
      ...spike,
      relatedChange: correlateChange(
        spike.firstSeen,
        changes,
        runtime.cfg.change_window_min * MILLISECONDS_PER_MINUTE,
      ),
    })),
  });
}

function makeSelfIdentity(cfg: Cfg) {
  return cfg.self_project_slug
    ? {
      projectSlug: cfg.self_project_slug,
      ...(cfg.self_project_id && { projectId: cfg.self_project_id }),
    }
    : null;
}

async function fetchIssues(
  params: {
    readonly caps: CapabilityInvoker;
    readonly cfg: Cfg;
    readonly toolCtx: ToolCtx;
    readonly chain: NonNullable<ToolCtx["chain"]>;
  },
): Promise<FeedItem[] | null | string> {
  const result = await Effect.runPromise(Effect.result(params.caps.invoke(
    "issue-feed@1",
    { limit: params.cfg.feed_limit, windowHours: params.cfg.window_hours },
    { chain: params.chain, origin: params.toolCtx.origin },
  )));
  if (Result.isFailure(result)) return degradeForModel(result.failure);
  return (result.success as { items: FeedItem[] | null; }).items;
}

function selectFresh(params: {
  readonly items: FeedItem[];
  readonly cfg: Cfg;
  readonly seen: ReturnType<typeof makeSeenSet>;
  readonly cooldown: ReturnType<typeof makeCooldown>;
  readonly selfIdentity: ReturnType<typeof makeSelfIdentity>;
}) {
  const spikes = selectSpikes(params.items, {
    minCount: params.cfg.min_count,
    seen: params.seen,
    ignoreSubstrings: params.cfg.ignore_substrings,
    ...(params.selfIdentity && {
      isSelf: (item: FeedItem) =>
        isSelfReference(params.selfIdentity!, {
          ...(item.key && { shortId: item.key }),
          ...(item.project && { project: item.project }),
          ...(item.url && { url: item.url }),
        }),
    }),
  }).filter((spike) => !params.cooldown.active(spike.key));
  markSeen(params.items, { minCount: params.cfg.min_count, seen: params.seen });
  for (const spike of spikes) params.cooldown.touch(spike.key);
  return spikes;
}

async function fetchChanges(
  params: {
    readonly caps: CapabilityInvoker;
    readonly toolCtx: ToolCtx;
    readonly chain: NonNullable<ToolCtx["chain"]>;
    readonly spikes: readonly unknown[];
  },
): Promise<ChangeEvent[]> {
  if (
    params.spikes.length === 0
    || !params.caps.available("change-feed@1")
  ) return [];
  const result = await Effect.runPromise(Effect.result(params.caps.invoke(
    "change-feed@1",
    { limit: CHANGE_FEED_LIMIT },
    { chain: params.chain, origin: params.toolCtx.origin },
  )));
  return Result.isSuccess(result)
    ? (result.success as { changes: ChangeEvent[]; }).changes
    : [];
}

function skippedResult(): string {
  return JSON.stringify({
    skipped: "feed fetch failed; state untouched",
    fresh: [],
  });
}

function baselineResult(): string {
  return JSON.stringify({
    baseline: true,
    note: "first successful poll seeds the baseline; nothing is fresh",
    fresh: [],
  });
}
