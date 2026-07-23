import type { Aggregate, AggregateOptions, WatchRow } from "./types.js";

function emptyAggregate(): Aggregate {
  return { numerator: 0, denominator: 0, activity: 0 };
}

function addRow(
  aggregate: Aggregate,
  row: WatchRow,
  opts: AggregateOptions,
): void {
  const value = row.metrics[opts.metric];
  const weight = opts.activityMetric
    ? Math.max(row.metrics[opts.activityMetric] ?? 0, 0)
    : 1;
  if (value !== undefined && weight > 0) {
    aggregate.numerator += value * weight;
    aggregate.denominator += weight;
  }
  if (opts.activityMetric) {
    aggregate.activity += row.metrics[opts.activityMetric] ?? 0;
  }
}

function finishAggregate(
  aggregate: Aggregate | undefined,
  opts: AggregateOptions,
): Record<string, number> | null {
  if (!aggregate) return null;
  const out: Record<string, number> = {};
  if (aggregate.denominator > 0) {
    out[opts.metric] = aggregate.numerator / aggregate.denominator;
  }
  if (opts.activityMetric) out[opts.activityMetric] = aggregate.activity;
  return Object.keys(out).length > 0 ? out : null;
}

export function aggregateFor(
  rows: readonly WatchRow[],
  subject: string,
  opts: AggregateOptions,
): Record<string, number> | null {
  const aggregate = emptyAggregate();
  let hasMatch = false;
  for (const row of rows) {
    if (row.id !== subject && row.series !== subject) continue;
    hasMatch = true;
    addRow(aggregate, row, opts);
  }
  return hasMatch ? finishAggregate(aggregate, opts) : null;
}

export function aggregateBySubject(
  rows: readonly WatchRow[],
  opts: AggregateOptions,
): Map<string, Record<string, number> | null> {
  const aggregates = new Map<string, Aggregate>();
  for (const row of rows) {
    const subjects = row.series === undefined || row.series === row.id
      ? [row.id]
      : [row.id, row.series];
    for (const subject of subjects) {
      const aggregate = aggregates.get(subject) ?? emptyAggregate();
      addRow(aggregate, row, opts);
      aggregates.set(subject, aggregate);
    }
  }
  return new Map(
    [...aggregates].map(([subject, aggregate]) => [
      subject,
      finishAggregate(aggregate, opts),
    ]),
  );
}
