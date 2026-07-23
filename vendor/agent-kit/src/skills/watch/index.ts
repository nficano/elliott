/**
 * skills/watch (CAPABILITIES-TDD §9.2) — generic observe → diff → trend →
 * outcomes over any `metric-rows@1` provider. Disabled by default (§5).
 */
export { diffSnapshots, rowKey } from "./diff.js";
export {
  DEFAULT_RETIRE_DAYS,
  DEFAULT_SOAK_DAYS,
  measureOutcomes,
  recordOutcome,
} from "./outcomes.js";
export { watchPack, watchSkill } from "./skills.js";
export { DEFAULT_RETAIN_SNAPSHOTS, makeMemoryWatchStore } from "./store.js";
export { decaying, splitAttribution } from "./trend.js";
export type {
  DecayingSeries,
  DecayOptions,
  DiffOptions,
  MeasuredOutcome,
  MeasureOptions,
  OutcomeRecord,
  OutcomeReport,
  RecordInput,
  RowChange,
  SnapshotDiff,
  SplitEntry,
  SplitOptions,
  Verdict,
  WatchOverrides,
  WatchRow,
  WatchSnapshot,
  WatchStore,
} from "./types.js";
