import type * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { BridgePlan, BridgeSnapshot, KnownMigration } from "./types.js";

export type { BridgePlan, BridgeSnapshot, KnownMigration } from "./types.js";

export const EFFECT_MIGRATIONS_TABLE = "effect_sql_migrations";
export const LEGACY_MIGRATIONS_TABLE = "schema_migrations";
const BASELINE_VERSION = "0001_init";
const BASELINE_ID = 1;
const BASELINE_NAME = "init";
const BASELINE_SENTINEL_COUNT = 7;
const BASELINE_MIGRATIONS: readonly KnownMigration[] = [{
  id: BASELINE_ID,
  name: BASELINE_NAME,
  version: BASELINE_VERSION,
}];

export function planCompatibilityBridge(
  snapshot: BridgeSnapshot,
  knownMigrations: readonly KnownMigration[] = BASELINE_MIGRATIONS,
): BridgePlan {
  if (snapshot.baselineSentinels.length !== BASELINE_SENTINEL_COUNT) {
    return invalid("baseline sentinel query returned an unexpected shape");
  }
  const anySentinel = snapshot.baselineSentinels.some(Boolean);
  const allSentinels = snapshot.baselineSentinels.every(Boolean);
  if (anySentinel && !allSentinels) {
    return invalid("partial baseline schema detected");
  }
  const ledgerError = validateLedgerRows(snapshot, knownMigrations);
  if (ledgerError) return invalid(ledgerError);
  const alignmentError = validateLedgerAlignment(snapshot, knownMigrations);
  if (alignmentError) return invalid(alignmentError);
  return planLedgerState(snapshot, allSentinels);
}

function validateLedgerRows(
  snapshot: BridgeSnapshot,
  knownMigrations: readonly KnownMigration[],
): string | undefined {
  const knownVersions = new Set(knownMigrations.map((row) => row.version));
  if (snapshot.legacyVersions.some((version) => !knownVersions.has(version))) {
    return "legacy migration ledger contains unknown versions";
  }
  const knownById = new Map(knownMigrations.map((row) => [row.id, row.name]));
  const unexpectedEffect = snapshot.effectMigrations.some((row) => {
    return knownById.get(row.id) !== row.name;
  });
  return unexpectedEffect
    ? "Effect migration ledger contains an unknown or renamed migration"
    : undefined;
}

function validateLedgerAlignment(
  snapshot: BridgeSnapshot,
  knownMigrations: readonly KnownMigration[],
): string | undefined {
  const legacy = new Set(snapshot.legacyVersions);
  const effect = new Set(snapshot.effectMigrations.map((row) => row.id));
  const mismatch = knownMigrations
    .filter((row) => row.id !== BASELINE_ID)
    .some((row) => legacy.has(row.version) !== effect.has(row.id));
  if (mismatch) return "legacy and Effect migration ledgers are inconsistent";

  const maximumAppliedId = Math.max(0, ...effect);
  const hasGap = knownMigrations.some((row) =>
    row.id <= maximumAppliedId && !effect.has(row.id)
  );
  return hasGap
    ? "Effect migration ledger is missing an earlier migration"
    : undefined;
}

function planLedgerState(
  snapshot: BridgeSnapshot,
  allSentinels: boolean,
): BridgePlan {
  const baselineLegacy = snapshot.legacyVersions.includes(BASELINE_VERSION);
  const baselineEffect = snapshot.effectMigrations.some((row) =>
    row.id === BASELINE_ID
  );
  if (!baselineLegacy && !baselineEffect) {
    return allSentinels
      ? invalid("baseline schema exists without migration ledger entries")
      : { _tag: "Fresh" };
  }
  if (!allSentinels) {
    return invalid("migration ledger claims a missing baseline schema");
  }
  if (baselineLegacy && !baselineEffect) {
    return { _tag: "SeedEffectBaseline" };
  }
  return baselineLegacy
    ? { _tag: "Ready" }
    : invalid("Effect baseline exists without the legacy compatibility row");
}

function invalid(message: string): BridgePlan {
  return { _tag: "Invalid", message };
}

export function bridgeLegacyBaseline(
  sql: PgClient.PgClient,
  knownMigrations: readonly KnownMigration[],
): Effect.Effect<void, Migrator.MigrationError | SqlError> {
  return Effect.gen(function*() {
    yield* sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('agent-kit:migrations', 0)
      )
    `;
    const snapshot = yield* readBridgeSnapshot(sql);
    const plan = planCompatibilityBridge(snapshot, knownMigrations);
    if (plan._tag === "Invalid") {
      return yield* new Migrator.MigrationError({
        kind: "BadState",
        message: `migration compatibility check failed: ${plan.message}`,
      });
    }
    if (plan._tag === "SeedEffectBaseline") {
      yield* ensureEffectTable(sql);
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${BASELINE_ID}, ${BASELINE_NAME})
      `;
    }
  });
}

function readBridgeSnapshot(
  sql: PgClient.PgClient,
): Effect.Effect<BridgeSnapshot, SqlError> {
  return Effect.gen(function*() {
    const tables = yield* sql<{
      legacy_table: string | null;
      effect_table: string | null;
    }>`
      SELECT to_regclass('schema_migrations')::text AS legacy_table,
             to_regclass('effect_sql_migrations')::text AS effect_table
    `;
    if (tables[0]?.legacy_table) {
      yield* sql`LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE`;
    }
    const legacyVersions = tables[0]?.legacy_table
      ? (yield* sql<{ version: string; }>`
        SELECT version FROM schema_migrations ORDER BY version
      `).map((row) => row.version)
      : [];
    const effectMigrations = tables[0]?.effect_table
      ? yield* sql<{ migration_id: number; name: string; }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        ORDER BY migration_id
      `
      : [];
    const baselineSentinels = yield* readBaselineSentinels(sql);
    return {
      legacyVersions,
      effectMigrations: effectMigrations.map((row) => ({
        id: Number(row.migration_id),
        name: row.name,
      })),
      baselineSentinels,
    };
  });
}

function readBaselineSentinels(
  sql: PgClient.PgClient,
): Effect.Effect<readonly boolean[], SqlError> {
  return Effect.map(
    sql<{ names: Array<string | null>; }>`
      SELECT ARRAY[
        to_regclass('memory')::text,
        to_regclass('history')::text,
        to_regclass('jobs')::text,
        to_regclass('schedule')::text,
        to_regclass('processed_inbound')::text,
        to_regclass('footprint_ledger')::text,
        to_regclass('kv')::text
      ] AS names
    `,
    (rows) => (rows[0]?.names ?? []).map((name) => name !== null),
  );
}

export function ensureLegacyTable(sql: SqlClient.SqlClient) {
  return sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export function ensureEffectTable(sql: SqlClient.SqlClient) {
  return sql`
    CREATE TABLE IF NOT EXISTS effect_sql_migrations (
      migration_id integer PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      name text NOT NULL
    )
  `;
}
