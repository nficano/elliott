import type {
  Aggregate,
  DecayingSeries,
  DecayOptions,
  SeriesPoint,
  SplitEntry,
  SplitOptions,
  WatchRow,
  WatchSnapshot,
} from "./types.js";

/**
 * Long-horizon signals over a snapshot window (CAPABILITIES-TDD §9.2) — pure.
 * `decaying`: a series whose weighted metric slid the wrong way across ≥N
 * snapshots while still earning activity (quiet erosion, not a one-day wobble).
 * `splitAttribution`: one id served by ≥2 series — split attribution, i.e.
 * effort splitting across resources that should consolidate.
 */

const DEFAULT_MIN_SNAPSHOTS = 3;
const DEFAULT_SHARE_MIN = 0.25;

export function decaying(
  history: readonly WatchSnapshot[],
  opts: DecayOptions,
): DecayingSeries[] {
  const perSeries = collectSeriesPoints(history, opts);
  const decays = [...perSeries].flatMap(([series, points]) => {
    const decay = decayForSeries(series, points, opts);
    return decay ? [decay] : [];
  });
  decays.sort((a, b) => Math.abs(b.slide) - Math.abs(a.slide));
  return opts.limit ? decays.slice(0, opts.limit) : decays;
}

function collectSeriesPoints(
  history: readonly WatchSnapshot[],
  opts: DecayOptions,
): Map<string, SeriesPoint[]> {
  const perSeries = new Map<string, SeriesPoint[]>();
  for (const snapshot of history) {
    for (const [series, aggregate] of aggregateSnapshot(snapshot, opts)) {
      if (aggregate.denominator === 0) continue;
      const points = perSeries.get(series) ?? [];
      points.push({
        value: aggregate.numerator / aggregate.denominator,
        activity: aggregate.activity,
      });
      perSeries.set(series, points);
    }
  }
  return perSeries;
}

function aggregateSnapshot(
  snapshot: WatchSnapshot,
  opts: DecayOptions,
): Map<string, Aggregate> {
  const aggregates = new Map<string, Aggregate>();
  for (const row of snapshot.rows) {
    const series = row.series ?? row.id;
    const aggregate = aggregates.get(series)
      ?? { numerator: 0, denominator: 0, activity: 0 };
    addToAggregate(aggregate, row, opts);
    aggregates.set(series, aggregate);
  }
  return aggregates;
}

function addToAggregate(
  aggregate: Aggregate,
  row: WatchRow,
  opts: DecayOptions,
): void {
  const value = row.metrics[opts.metric];
  const weight = opts.weightMetric
    ? Math.max(row.metrics[opts.weightMetric] ?? 0, 0)
    : 1;
  if (value !== undefined && weight > 0) {
    aggregate.numerator += value * weight;
    aggregate.denominator += weight;
  }
  if (opts.activityMetric) {
    aggregate.activity += row.metrics[opts.activityMetric] ?? 0;
  }
}

function decayForSeries(
  series: string,
  points: readonly SeriesPoint[],
  opts: DecayOptions,
): DecayingSeries | null {
  if (points.length < (opts.minSnapshots ?? DEFAULT_MIN_SNAPSHOTS)) return null;
  const first = points[0]!.value;
  const last = points.at(-1)!.value;
  const slide = last - first;
  const worsening = opts.direction === "up-good" ? -slide : slide;
  if (worsening < opts.slideThreshold) return null;
  const activity = points.at(-1)!.activity;
  if (opts.activityMin !== undefined && activity < opts.activityMin) {
    return null;
  }
  return { series, first, last, slide, points: points.length, activity };
}

export function splitAttribution(
  rows: readonly WatchRow[],
  opts: SplitOptions,
): SplitEntry[] {
  const shareMin = opts.shareMin ?? DEFAULT_SHARE_MIN;
  const weightMin = opts.weightMin ?? 0;
  const byId = groupSeriesWeights(rows, opts.weightMetric);
  const out = [...byId].flatMap(([id, seriesMap]) => {
    const split = splitForId({ id, seriesMap, shareMin, weightMin });
    return split ? [split] : [];
  });
  out.sort((a, b) => b.totalWeight - a.totalWeight);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

function groupSeriesWeights(
  rows: readonly WatchRow[],
  weightMetric: string,
): Map<string, Map<string, number>> {
  const byId = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.series === undefined) continue;
    const weight = row.metrics[weightMetric] ?? 0;
    const seriesMap = byId.get(row.id) ?? new Map<string, number>();
    seriesMap.set(row.series, (seriesMap.get(row.series) ?? 0) + weight);
    byId.set(row.id, seriesMap);
  }
  return byId;
}

function splitForId(params: {
  readonly id: string;
  readonly seriesMap: ReadonlyMap<string, number>;
  readonly shareMin: number;
  readonly weightMin: number;
}): SplitEntry | null {
  if (params.seriesMap.size < 2) return null;
  const total = [...params.seriesMap.values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (total <= 0) return null;
  const qualified = qualifiedSeries({
    seriesMap: params.seriesMap,
    total,
    shareMin: params.shareMin,
    weightMin: params.weightMin,
  });
  if (qualified.length < 2) return null;
  return { id: params.id, totalWeight: total, series: qualified };
}

function qualifiedSeries(
  params: {
    readonly seriesMap: ReadonlyMap<string, number>;
    readonly total: number;
    readonly shareMin: number;
    readonly weightMin: number;
  },
): { series: string; weight: number; share: number; }[] {
  const series = [...params.seriesMap]
    .map(([name, weight]) => ({
      series: name,
      weight,
      share: weight / params.total,
    }))
    .sort((a, b) => b.weight - a.weight);
  // The primary always counts; secondaries must clear both floors.
  return series.filter((entry, index) =>
    index === 0
    || (entry.share >= params.shareMin && entry.weight >= params.weightMin)
  );
}
