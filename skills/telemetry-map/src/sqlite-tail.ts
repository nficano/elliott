import { Database } from "bun:sqlite";
import type {
  DbCollected,
  DbSnapshot,
  DbTableStat,
  TailDelta,
  TailListener,
} from "./types";

const RECENT_LIMIT = 6;

// Tables whose most-recent rows are surfaced in the DB panel. Others still get a
// live count + delta, but their rows are not echoed.
const RECENT_TABLES = new Set([
  "runs",
  "tool_calls",
  "model_selections",
  "model_usage",
  "messages",
  "feedback",
  "scheduled_jobs",
  "component_uses",
  "sessions",
]);

// A read-only tail of sessions.sqlite. Opens with { readonly: true }, discovers
// tables dynamically, and reports per-table counts, deltas, and recent rows. It
// never writes and tolerates the file being briefly absent at boot.
export class SqliteTail {
  readonly #path: string;
  readonly #listener: TailListener;
  readonly #report: (error: unknown) => void;
  readonly #counts = new Map<string, number>();
  #db: Database | undefined;

  constructor(
    dbPath: string,
    listener: TailListener,
    report: (error: unknown) => void,
  ) {
    this.#path = dbPath;
    this.#listener = listener;
    this.#report = report;
  }

  tick(): void {
    const db = this.#open();
    if (db === undefined) return;
    try {
      const collected = this.#collect(db);
      this.#listener(collected.snapshot, collected.deltas);
    } catch (error) {
      this.#report(error);
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  #open(): Database | undefined {
    if (this.#db !== undefined) return this.#db;
    try {
      this.#db = new Database(this.#path, { readonly: true });
      return this.#db;
    } catch {
      return undefined;
    }
  }

  #collect(db: Database): DbCollected {
    const tables: DbTableStat[] = [];
    const deltas: TailDelta[] = [];
    const recent: Record<string, readonly unknown[]> = {};
    for (const table of this.#tables(db)) {
      const count = this.#count(db, table);
      const delta = count - (this.#counts.get(table) ?? 0);
      this.#counts.set(table, count);
      tables.push({ table, count, delta });
      if (delta > 0) deltas.push({ table, count, delta });
      if (RECENT_TABLES.has(table)) recent[table] = this.#recent(db, table);
    }
    const snapshot: DbSnapshot = {
      at: new Date().toISOString(),
      tables,
      recent,
    };
    return { snapshot, deltas };
  }

  #tables(db: Database): readonly string[] {
    return db
      .query<{ name: string; }, []>(
        "SELECT name FROM sqlite_master WHERE type='table'"
          + " AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%'",
      )
      .all()
      .map((row) => row.name);
  }

  #count(db: Database, table: string): number {
    const row = db
      .query<{ n: number; }, []>(`SELECT COUNT(*) AS n FROM "${table}"`)
      .get();
    return row?.n ?? 0;
  }

  #recent(db: Database, table: string): readonly unknown[] {
    return db
      .query<Record<string, unknown>, []>(
        `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${RECENT_LIMIT}`,
      )
      .all();
  }
}
