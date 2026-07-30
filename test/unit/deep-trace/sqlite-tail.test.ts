import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteTail } from "../../../skills/deep-trace/src/sqlite-tail";
import type {
  DbSnapshot,
  TailDelta,
} from "../../../skills/deep-trace/src/types";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const makeDbFile = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "deep-trace-tail-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "sessions.sqlite");
};

const seed = (file: string): Database => {
  const db = new Database(file);
  db.run("CREATE TABLE runs (id TEXT PRIMARY KEY, note TEXT)");
  db.run("CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT)");
  db.run("CREATE TABLE internal_cache (k TEXT)");
  db.run("CREATE VIRTUAL TABLE notes_fts USING fts5(body)");
  db.run("INSERT INTO runs VALUES ('r1', 'one'), ('r2', 'two')");
  db.run("INSERT INTO messages VALUES ('m1', 'hello')");
  return db;
};

const collect = (
  file: string,
): {
  tail: SqliteTail;
  snapshots: DbSnapshot[];
  deltas: TailDelta[][];
  errors: unknown[];
} => {
  const snapshots: DbSnapshot[] = [];
  const deltas: TailDelta[][] = [];
  const errors: unknown[] = [];
  const tail = new SqliteTail(
    file,
    (snapshot, tickDeltas) => {
      snapshots.push(snapshot);
      deltas.push([...tickDeltas]);
    },
    (error) => errors.push(error),
  );
  cleanups.push(async () => {
    tail.close();
  });
  return { tail, snapshots, deltas, errors };
};

describe("SqliteTail with a live database", () => {
  it("reports per-table counts and treats first observation as a delta", async () => {
    const file = await makeDbFile();
    const db = seed(file);
    db.close();
    const { tail, snapshots, deltas } = collect(file);
    tail.tick();
    expect(snapshots.length).toBe(1);
    const byName = new Map(
      snapshots[0]?.tables.map((stat) => [stat.table, stat]),
    );
    expect(byName.get("runs")).toEqual({ table: "runs", count: 2, delta: 2 });
    expect(byName.get("messages")).toEqual({
      table: "messages",
      count: 1,
      delta: 1,
    });
    expect(
      deltas[0]?.map((delta) => delta.table)
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(["messages", "runs"]);
  });

  it("excludes sqlite internals and fts tables from the report", async () => {
    const file = await makeDbFile();
    seed(file).close();
    const { tail, snapshots } = collect(file);
    tail.tick();
    const names = snapshots[0]?.tables.map((stat) => stat.table) ?? [];
    expect(names).toContain("runs");
    expect(names.some((name) => name.startsWith("sqlite_"))).toBe(false);
    expect(names.some((name) => name.includes("fts"))).toBe(false);
  });

  it("computes deltas between ticks and only surfaces growing tables", async () => {
    const file = await makeDbFile();
    const db = seed(file);
    const { tail, snapshots, deltas } = collect(file);
    tail.tick();
    db.run("INSERT INTO runs VALUES ('r3', 'three')");
    tail.tick();
    db.close();
    expect(snapshots.length).toBe(2);
    const runs = snapshots[1]?.tables.find((stat) => stat.table === "runs");
    expect(runs).toEqual({ table: "runs", count: 3, delta: 1 });
    expect(deltas[1]).toEqual([{ table: "runs", count: 3, delta: 1 }]);
    const messages = snapshots[1]?.tables.find(
      (stat) => stat.table === "messages",
    );
    expect(messages?.delta).toBe(0);
  });

  it("surfaces recent rows only for allow-listed tables, newest first, capped at 6", async () => {
    const file = await makeDbFile();
    const db = seed(file);
    for (let index = 3; index <= 10; index += 1) {
      db.run(`INSERT INTO runs VALUES ('r${index}', 'row ${index}')`);
    }
    db.close();
    const { tail, snapshots } = collect(file);
    tail.tick();
    const recent = snapshots[0]?.recent ?? {};
    expect(
      Object.keys(recent).sort((left, right) => left.localeCompare(right)),
    ).toEqual(["messages", "runs"]);
    const runs = recent["runs"] as { id: string; }[];
    expect(runs.length).toBe(6);
    expect(runs[0]?.id).toBe("r10");
    expect(runs[5]?.id).toBe("r5");
    expect(recent["internal_cache"]).toBeUndefined();
  });

  it("stamps each snapshot with a parseable timestamp", async () => {
    const file = await makeDbFile();
    seed(file).close();
    const { tail, snapshots } = collect(file);
    tail.tick();
    const at = snapshots[0]?.at ?? "";
    expect(new Date(at).toString()).not.toBe("Invalid Date");
  });

  it("keeps working after close() by reopening on the next tick", async () => {
    const file = await makeDbFile();
    seed(file).close();
    const { tail, snapshots } = collect(file);
    tail.tick();
    tail.close();
    tail.tick();
    expect(snapshots.length).toBe(2);
  });
});

describe("SqliteTail without a database", () => {
  it("silently skips ticks while the file is absent", async () => {
    const file = path.join(
      await mkdtemp(path.join(tmpdir(), "deep-trace-none-")),
      "missing.sqlite",
    );
    const { tail, snapshots, errors } = collect(file);
    tail.tick();
    expect(snapshots).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("starts reporting once the file appears", async () => {
    const file = await makeDbFile();
    const { tail, snapshots } = collect(file);
    tail.tick();
    expect(snapshots).toEqual([]);
    seed(file).close();
    tail.tick();
    expect(snapshots.length).toBe(1);
  });
});
