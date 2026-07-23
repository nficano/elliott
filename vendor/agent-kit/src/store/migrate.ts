import * as PgClient from "@effect/sql-pg/PgClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bridgeLegacyBaseline,
  EFFECT_MIGRATIONS_TABLE,
  ensureEffectTable,
  ensureLegacyTable,
} from "./migration-bridge.js";
import type { MigrateResult, MigrationFile } from "./types.js";

export {
  EFFECT_MIGRATIONS_TABLE,
  LEGACY_MIGRATIONS_TABLE,
  planCompatibilityBridge,
} from "./migration-bridge.js";
export type {
  BridgePlan,
  BridgeSnapshot,
  KnownMigration,
  MigrationFile,
} from "./types.js";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export function parseMigrationFilename(
  file: string,
): MigrationFile | undefined {
  const match = /^(\d+)_([^.]+)\.sql$/.exec(file);
  if (!match) return undefined;
  const prefix = match[1];
  const name = match[2];
  if (!prefix || !name) return undefined;
  const id = Number(prefix);
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return { file, id, name, version: `${prefix}_${name}` };
}

export function orderMigrationFiles(
  files: readonly string[],
): readonly MigrationFile[] {
  return files
    .map(parseMigrationFilename)
    .filter((file): file is MigrationFile => file !== undefined)
    .toSorted((left, right) =>
      left.id - right.id || left.name.localeCompare(right.name)
    );
}

export function migrate(
  sql: PgClient.PgClient,
  dir = MIGRATIONS_DIR,
): Effect.Effect<
  MigrateResult,
  Migrator.MigrationError | SqlError
> {
  return Effect.gen(function*() {
    const migrations = yield* discoverMigrations(dir);
    const loader = makeLoader(migrations, dir);
    // Effect Migrator checks a missing PostgreSQL table by catching a failed
    // regclass query. PostgreSQL still marks an enclosing transaction aborted,
    // so create the empty ledger before entering the atomic bridge transaction.
    yield* ensureEffectTable(sql);
    return yield* sql.withTransaction(
      Effect.gen(function*() {
        yield* bridgeLegacyBaseline(sql, migrations);
        const applied = yield* Migrator.make({})({
          loader,
          table: EFFECT_MIGRATIONS_TABLE,
        }).pipe(Effect.provideService(SqlClient.SqlClient, sql));
        const appliedIds = new Set(applied.map(([id]) => id));
        return {
          applied: migrations
            .filter((migration) => appliedIds.has(migration.id))
            .map((migration) => migration.version),
          skipped: migrations.length - applied.length,
        };
      }),
    );
  });
}

function discoverMigrations(
  dir: string,
): Effect.Effect<readonly MigrationFile[], Migrator.MigrationError> {
  return Effect.tryPromise({
    try: () => readdir(dir),
    catch: (cause) =>
      new Migrator.MigrationError({
        kind: "Failed",
        message: `failed to read migrations directory: ${dir}`,
        cause,
      }),
  }).pipe(
    Effect.map(orderMigrationFiles),
    Effect.flatMap(rejectDuplicateIds),
  );
}

function rejectDuplicateIds(
  files: readonly MigrationFile[],
): Effect.Effect<readonly MigrationFile[], Migrator.MigrationError> {
  const ids = new Set(files.map((file) => file.id));
  return ids.size === files.length
    ? Effect.succeed(files)
    : Effect.fail(
      new Migrator.MigrationError({
        kind: "Duplicates",
        message: "migration files contain duplicate numeric ids",
      }),
    );
}

function makeLoader(
  migrations: readonly MigrationFile[],
  dir: string,
): Migrator.Loader {
  return Effect.succeed(
    migrations.map((migration) => [
      migration.id,
      migration.name,
      Effect.succeed(loadMigration(migration, dir)),
    ]),
  );
}

function loadMigration(
  migration: MigrationFile,
  dir: string,
): Effect.Effect<
  void,
  Migrator.MigrationError | SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function*() {
    const client = yield* SqlClient.SqlClient;
    const text = yield* Effect.tryPromise({
      try: () => readFile(path.join(dir, migration.file), "utf8"),
      catch: (cause) =>
        new Migrator.MigrationError({
          kind: "ImportError",
          message: `failed to read migration ${migration.file}`,
          cause,
        }),
    });
    yield* client.unsafe(text).unprepared;
    yield* ensureLegacyTable(client);
    yield* client`
      INSERT INTO schema_migrations (version)
      VALUES (${migration.version})
      ON CONFLICT (version) DO NOTHING
    `;
  });
}

if (import.meta.main) {
  const dsn = process.env.AGENT_KIT_DSN;
  if (!dsn) {
    console.error("AGENT_KIT_DSN not set");
    process.exit(1);
  }
  const runtime = ManagedRuntime.make(PgClient.layer({
    url: Redacted.make(dsn),
    maxConnections: 1,
    applicationName: "agent-kit-migrate",
  }));
  try {
    const context = await runtime.context();
    const sql = Context.get(context, PgClient.PgClient);
    const result = await Effect.runPromise(migrate(sql));
    console.info(
      `migrations: applied ${result.applied.length} (${
        result.applied.join(", ") || "none"
      })`,
    );
  } finally {
    await runtime.dispose();
  }
}
