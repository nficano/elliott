import type {
  ComparedRow,
  DiffOptions,
  RowChange,
  SnapshotDiff,
  WatchRow,
  WatchSnapshot,
} from "./types.js";

/**
 * Snapshot-over-snapshot diff (CAPABILITIES-TDD §9.2) — pure, direction-aware.
 * Rows are keyed by id+series joined with `\0` so the same id on two series
 * never collides with real text.
 */

export function rowKey(r: Pick<WatchRow, "id" | "series">): string {
  return `${r.id}\0${r.series ?? ""}`;
}

export function diffSnapshots(
  current: WatchSnapshot,
  previous: WatchSnapshot,
  opts: DiffOptions,
): SnapshotDiff {
  const prevByKey = new Map(previous.rows.map((r) => [rowKey(r), r]));
  const curKeys = new Set(current.rows.map((r) => rowKey(r)));
  const compared = current.rows.map((row) =>
    compareRow(row, prevByKey.get(rowKey(row)), opts)
  );
  const improved = changesOf(compared, "improved");
  const declined = changesOf(compared, "declined");
  const entered = compared.flatMap((result) =>
    result.kind === "entered" ? [result.row] : []
  );
  const exited = previous.rows.filter((r) => !curKeys.has(rowKey(r)));
  const actNow = opts.activityMetric && opts.actNowMin !== undefined
    ? declined.filter((change) => change.activity >= opts.actNowMin!)
    : [];
  const magnitude = (c: RowChange): number => Math.abs(c.delta);
  return {
    improved: [...improved].sort((a, b) => magnitude(b) - magnitude(a)),
    declined: [...declined].sort((a, b) => magnitude(b) - magnitude(a)),
    entered,
    exited,
    actNow,
  };
}

function compareRow(
  row: WatchRow,
  previous: WatchRow | undefined,
  opts: DiffOptions,
): ComparedRow {
  if (!previous) return { kind: "entered", row };
  const from = previous.metrics[opts.metric];
  const to = row.metrics[opts.metric];
  if (from === undefined || to === undefined) return { kind: "unchanged" };
  const delta = to - from;
  if (Math.abs(delta) < opts.moveThreshold) return { kind: "unchanged" };
  const activity = activityFor(row, previous, opts.activityMetric);
  const change: RowChange = {
    id: row.id,
    ...((row.series !== undefined) && { series: row.series }),
    from,
    to,
    delta,
    activity,
  };
  const isBetter = opts.direction === "up-good" ? delta > 0 : delta < 0;
  return { kind: isBetter ? "improved" : "declined", change };
}

function activityFor(
  row: WatchRow,
  previous: WatchRow,
  metric: string | undefined,
): number {
  if (!metric) return 0;
  return row.metrics[metric] ?? previous.metrics[metric] ?? 0;
}

function changesOf(
  rows: readonly ComparedRow[],
  kind: "improved" | "declined",
): RowChange[] {
  return rows.flatMap((row) =>
    row.kind === kind && "change" in row ? [row.change] : []
  );
}
