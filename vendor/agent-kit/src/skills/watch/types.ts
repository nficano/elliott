import type { ToolCtx } from "../../core/agent/types.js";
import type { WatchConfig } from "./schema.js";

export type Cfg = typeof WatchConfig.Type;

export interface WatchRow {
  readonly id: string;
  readonly series?: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface WatchSnapshot {
  /** ISO day, e.g. "2026-07-21" — the snapshot identity within a key. */
  readonly date: string;
  readonly rows: readonly WatchRow[];
}

export interface OutcomeRecord {
  readonly id: string; // `<kind>:<subject>:<isoDay>` — same day re-records replace
  readonly recordedAt: string;
  readonly kind: string;
  readonly subject: string;
  readonly note?: string;
  readonly ref?: string; // e.g. the proposal/PR url
  readonly baseline: Readonly<Record<string, number>>;
}

export interface WatchStore {
  save(key: string, snap: WatchSnapshot): Promise<void>;
  /** Most recent snapshot strictly before `date`, or null = baseline run. */
  previous(key: string, date: string): Promise<WatchSnapshot | null>;
  /** Up to `limit` snapshots ≤ `date`, oldest-first — the trend window. */
  history(key: string, date: string, limit: number): Promise<WatchSnapshot[]>;
  loadLedger(key: string): Promise<OutcomeRecord[]>;
  saveLedger(key: string, records: OutcomeRecord[]): Promise<void>;
}

export interface DiffOptions {
  /** The ranked metric, e.g. "rank" or "latency_p95". */
  readonly metric: string;
  /** Whether a larger value is better (`up-good`) or worse (`down-good`). */
  readonly direction: "up-good" | "down-good";
  /** Minimum absolute move to report at all. */
  readonly moveThreshold: number;
  /** Secondary activity metric (e.g. "clicks", "requests") for the act-now cut. */
  readonly activityMetric?: string;
  /** Declines whose activity ≥ this floor land in `actNow`. */
  readonly actNowMin?: number;
}

export interface RowChange {
  readonly id: string;
  readonly series?: string;
  readonly from: number;
  readonly to: number;
  readonly delta: number;
  readonly activity: number;
}

export interface SnapshotDiff {
  readonly improved: readonly RowChange[];
  readonly declined: readonly RowChange[];
  readonly entered: readonly WatchRow[];
  readonly exited: readonly WatchRow[];
  /** Declined AND active — the "fix this first" subset. */
  readonly actNow: readonly RowChange[];
}

export interface RecordInput {
  readonly kind: string;
  readonly subject: string; // the id or series the change targeted
  readonly baseline: Readonly<Record<string, number>>;
  readonly note?: string;
  readonly ref?: string;
  readonly now: Date;
}

export type Verdict = "improved" | "declined" | "flat" | "no-data";

export interface MeasureOptions {
  readonly metric: string;
  readonly direction: "up-good" | "down-good";
  /** Moves within ± this epsilon count as no move (day-scale wobble). */
  readonly epsilon?: number;
  readonly activityMetric?: string;
  /** Relative activity change that counts as a real move (default 10%). */
  readonly activityRelThreshold?: number;
  readonly soakDays?: number;
  readonly retireDays?: number;
  readonly now: Date;
}

export interface MeasuredOutcome {
  readonly record: OutcomeRecord;
  readonly current: Readonly<Record<string, number>>;
  readonly verdict: Verdict;
}

export interface OutcomeReport {
  readonly measured: readonly MeasuredOutcome[];
  readonly soaking: readonly OutcomeRecord[];
  readonly retiredCount: number;
}

export interface DecayOptions {
  readonly metric: string;
  readonly direction: "up-good" | "down-good";
  /** Weight for the per-series weighted mean (defaults to plain mean). */
  readonly weightMetric?: string;
  /** Total current activity a series must still earn to matter. */
  readonly activityMetric?: string;
  readonly activityMin?: number;
  /** Minimum wrong-way slide (first → last weighted value). */
  readonly slideThreshold: number;
  readonly minSnapshots?: number;
  readonly limit?: number;
}

export interface DecayingSeries {
  readonly series: string;
  readonly first: number;
  readonly last: number;
  readonly slide: number;
  readonly points: number;
  readonly activity: number;
}

export interface SplitOptions {
  readonly weightMetric: string;
  /** A secondary series counts only at ≥ this share of the id's total weight… */
  readonly shareMin?: number;
  /** …and ≥ this absolute weight. */
  readonly weightMin?: number;
  readonly limit?: number;
}

export interface SplitEntry {
  readonly id: string;
  readonly totalWeight: number;
  readonly series: readonly {
    series: string;
    weight: number;
    share: number;
  }[];
}

export interface WatchOverrides {
  readonly store?: WatchStore;
  readonly now?: () => Date;
}

export interface Aggregate {
  numerator: number;
  denominator: number;
  activity: number;
}

export interface AggregateOptions {
  readonly metric: string;
  readonly activityMetric?: string;
}

export interface SeriesPoint {
  readonly value: number;
  readonly activity: number;
}

export type ComparedRow =
  | { readonly kind: "entered"; readonly row: WatchRow; }
  | {
    readonly kind: "improved" | "declined";
    readonly change: RowChange;
  }
  | { readonly kind: "unchanged"; };

export interface Signal {
  readonly present: boolean;
  readonly score: number;
}

export interface ToolRuntime {
  readonly cfg: Cfg;
  readonly store: WatchStore;
  readonly now: () => Date;
  readonly pullRows: (
    toolName: string,
    toolCtx: ToolCtx,
  ) => Promise<{ rows: WatchRow[]; } | { error: string; }>;
}
