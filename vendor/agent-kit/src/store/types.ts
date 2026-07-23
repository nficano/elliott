import type * as PgClient from "@effect/sql-pg/PgClient";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import type * as SqlError from "effect/unstable/sql/SqlError";
import type { Health } from "../core/types.js";

/**
 * The store (§3) — one dedicated Postgres doing five jobs (vectors, queue,
 * hybrid retrieval, footprint ledger, history/relational/kv). Postgres is the
 * one hard dependency (§5): unavailable at boot → fail fast; unavailable at
 * runtime → memory/jobs/scheduler degrade, chat still replies from history.
 */
export interface StorePort {
  /** Effect SQL PostgreSQL client. Available after the store lifecycle starts. */
  readonly sql: PgClient.PgClient;
  /** Run an Effect SQL program at an existing Promise boundary. */
  run<A, E>(effect: Effect.Effect<A, E>): Promise<A>;
  /**
   * A dedicated physical connection and its owning scope. Session state, such
   * as advisory locks, remains on this connection until `release`.
   */
  reserve(): Promise<ReservedConnection>;
  /** Postgres `now()` — the clock authority for leases/fires (§20). */
  now(): Effect.Effect<Date, SqlError.SqlError>;
  health(): Promise<Health>;
}

export interface ReservedConnection {
  readonly connection: SqlConnection.Connection;
  readonly scope: Scope.Closeable;
  release(): Promise<void>;
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: number;
}

export interface MigrationFile {
  readonly file: string;
  readonly id: number;
  readonly name: string;
  readonly version: string;
}

export interface KnownMigration {
  readonly id: number;
  readonly name: string;
  readonly version: string;
}

export interface BridgeSnapshot {
  readonly legacyVersions: readonly string[];
  readonly effectMigrations: readonly {
    readonly id: number;
    readonly name: string;
  }[];
  readonly baselineSentinels: readonly boolean[];
}

export type BridgePlan =
  | { readonly _tag: "Fresh"; }
  | { readonly _tag: "SeedEffectBaseline"; }
  | { readonly _tag: "Ready"; }
  | { readonly _tag: "Invalid"; readonly message: string; };
