import type {
  MeasuredOutcome,
  MeasureOptions,
  OutcomeRecord,
  OutcomeReport,
  RecordInput,
  Signal,
  Verdict,
} from "./types.js";

/**
 * The intervention ledger (CAPABILITIES-TDD §9.2) — "did the change work".
 * Record a baseline the moment a change ships; after a soak window re-measure
 * the same slice and issue a verdict; retire stale records so the report never
 * grows unbounded. Pure over the record list; the caller owns persistence.
 */

export const DEFAULT_SOAK_DAYS = 28;
export const DEFAULT_RETIRE_DAYS = 112;
export const DEFAULT_MAX_RECORDS = 100;
const ISO_DAY_LENGTH = 10;
const MILLISECONDS_PER_DAY = 86_400_000;
const DEFAULT_EPSILON = 0.5;
const DEFAULT_ACTIVITY_REL_THRESHOLD = 0.1;

/** Same kind+subject+day replaces (re-records aren't duplicates); capped. */
export function recordOutcome(
  records: readonly OutcomeRecord[],
  input: RecordInput,
  maxRecords = DEFAULT_MAX_RECORDS,
): OutcomeRecord[] {
  const day = input.now.toISOString().slice(0, ISO_DAY_LENGTH);
  const id = `${input.kind}:${input.subject}:${day}`;
  const next = records.filter((r) => r.id !== id);
  next.push({
    id,
    recordedAt: input.now.toISOString(),
    kind: input.kind,
    subject: input.subject,
    ...((input.note !== undefined) && { note: input.note }),
    ...((input.ref !== undefined) && { ref: input.ref }),
    baseline: input.baseline,
  });
  return next.slice(Math.max(0, next.length - maxRecords));
}

export async function measureOutcomes(
  records: readonly OutcomeRecord[],
  fetchCurrent: (
    record: OutcomeRecord,
  ) => Promise<Readonly<Record<string, number>> | null>,
  opts: MeasureOptions,
): Promise<OutcomeReport> {
  const soakMs = (opts.soakDays ?? DEFAULT_SOAK_DAYS) * MILLISECONDS_PER_DAY;
  const retireMs = (opts.retireDays ?? DEFAULT_RETIRE_DAYS)
    * MILLISECONDS_PER_DAY;
  const nowMs = opts.now.getTime();

  const live = records.filter((r) =>
    nowMs - Date.parse(r.recordedAt) <= retireMs
  );
  const retiredCount = records.length - live.length;
  const soaking = live.filter((r) => nowMs - Date.parse(r.recordedAt) < soakMs);
  const due = live.filter((r) => nowMs - Date.parse(r.recordedAt) >= soakMs);

  const measured: MeasuredOutcome[] = [];
  for (const record of due) {
    const current = await fetchCurrent(record);
    if (current === null) {
      measured.push({ record, current: {}, verdict: "no-data" });
      continue;
    }
    measured.push({
      record,
      current,
      verdict: verdictFor(record.baseline, current, opts),
    });
  }
  return { measured, soaking, retiredCount };
}

function verdictFor(
  baseline: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number>>,
  opts: MeasureOptions,
): Verdict {
  const metric = metricSignal({ baseline, current, opts });
  const activity = activitySignal({ baseline, current, opts });
  if (!metric.present && !activity.present) return "no-data";
  const score = metric.score + activity.score;
  if (score > 0) return "improved";
  if (score < 0) return "declined";
  return "flat";
}

function metricSignal(params: {
  readonly baseline: Readonly<Record<string, number>>;
  readonly current: Readonly<Record<string, number>>;
  readonly opts: MeasureOptions;
}): Signal {
  const from = params.baseline[params.opts.metric];
  const to = params.current[params.opts.metric];
  if (from === undefined || to === undefined) {
    return { present: false, score: 0 };
  }
  const delta = to - from;
  if (Math.abs(delta) <= (params.opts.epsilon ?? DEFAULT_EPSILON)) {
    return { present: true, score: 0 };
  }
  const isBetter = params.opts.direction === "up-good" ? delta > 0 : delta < 0;
  return { present: true, score: isBetter ? 1 : -1 };
}

function activitySignal(params: {
  readonly baseline: Readonly<Record<string, number>>;
  readonly current: Readonly<Record<string, number>>;
  readonly opts: MeasureOptions;
}): Signal {
  if (!params.opts.activityMetric) return { present: false, score: 0 };
  const from = params.baseline[params.opts.activityMetric];
  const to = params.current[params.opts.activityMetric];
  if (from === undefined || to === undefined) {
    return { present: false, score: 0 };
  }
  const relative = from === 0 ? Number(to > 0) : (to - from) / Math.abs(from);
  const threshold = params.opts.activityRelThreshold
    ?? DEFAULT_ACTIVITY_REL_THRESHOLD;
  if (relative >= threshold) return { present: true, score: 1 };
  if (relative <= -threshold) return { present: true, score: -1 };
  return { present: true, score: 0 };
}
