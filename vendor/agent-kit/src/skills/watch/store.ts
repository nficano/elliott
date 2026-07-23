/**
 * Watch persistence port (CAPABILITIES-TDD §9.2). Dated snapshots with a
 * retention cap + the outcome ledger. The port is the contract; a Postgres
 * impl is a migration away — the in-memory impl ships for tests and small
 * consumers. Corrupt/missing state degrades to "no data" (self-healing: the
 * next run rewrites), never an exception.
 */
import type { OutcomeRecord, WatchSnapshot, WatchStore } from "./types.js";

/** ~6 months of weekly snapshots — the prior art's retention stance. */
export const DEFAULT_RETAIN_SNAPSHOTS = 26;

export function makeMemoryWatchStore(
  retain = DEFAULT_RETAIN_SNAPSHOTS,
): WatchStore {
  const snaps = new Map<string, WatchSnapshot[]>(); // sorted by date asc
  const ledgers = new Map<string, OutcomeRecord[]>();

  return {
    async save(key, snap) {
      const arr = (snaps.get(key) ?? []).filter((s) => s.date !== snap.date);
      arr.push(snap);
      arr.sort((a, b) => a.date.localeCompare(b.date));
      snaps.set(key, arr.slice(Math.max(0, arr.length - retain)));
    },
    async previous(key, date) {
      const arr = snaps.get(key) ?? [];
      const before = arr.filter((s) => s.date < date);
      return before.length > 0 ? before.at(-1)! : null;
    },
    async history(key, date, limit) {
      const arr = (snaps.get(key) ?? []).filter((s) => s.date <= date);
      return arr.slice(Math.max(0, arr.length - limit));
    },
    async loadLedger(key) {
      return [...(ledgers.get(key) ?? [])];
    },
    async saveLedger(key, records) {
      ledgers.set(key, [...records]);
    },
  };
}
