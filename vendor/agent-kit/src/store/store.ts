import * as PgClient from "@effect/sql-pg/PgClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import type * as SqlError from "effect/unstable/sql/SqlError";
import { errorMessage } from "../core/errors.js";
import type { Health } from "../core/types.js";
import type { AgentKitConfig } from "../host/config/schema.js";
import { createPgLayer } from "./pool.js";
import type { ReservedConnection, StorePort } from "./types.js";

/**
 * Process-lifetime Effect SQL runtime. The ManagedRuntime owns the Pg pool scope
 * and deterministically closes it during subsystem shutdown.
 */
export class PostgresStore implements StorePort {
  private readonly runtime;
  private client: PgClient.PgClient | undefined;

  constructor(cfg: AgentKitConfig["store"]) {
    this.runtime = ManagedRuntime.make(createPgLayer(cfg));
  }

  get sql(): PgClient.PgClient {
    if (!this.client) {
      throw new Error("store SQL client used before lifecycle start");
    }
    return this.client;
  }

  async start(): Promise<void> {
    try {
      const context = await this.runtime.context();
      this.client = Context.get(context, PgClient.PgClient);
    } catch (error) {
      await this.runtime.dispose();
      throw error;
    }
  }

  run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(effect);
  }

  async reserve(): Promise<ReservedConnection> {
    const scope = await Effect.runPromise(Scope.make());
    let connection;
    try {
      connection = await Effect.runPromise(
        Scope.provide(this.sql.reserve, scope),
      );
    } catch (error) {
      await Effect.runPromise(Scope.close(scope, Exit.fail(error)));
      throw error;
    }
    let released = false;
    return {
      connection,
      scope,
      release: async () => {
        if (released) return;
        released = true;
        await Effect.runPromise(Scope.close(scope, Exit.void));
      },
    };
  }

  now(): Effect.Effect<Date, SqlError.SqlError> {
    return Effect.flatMap(
      this.sql<{ now: Date; }>`SELECT now() AS now`,
      (rows) => {
        const now = rows[0]?.now;
        return now
          ? Effect.succeed(now)
          : Effect.die(new Error("SELECT now() returned no row"));
      },
    );
  }

  async health(): Promise<Health> {
    try {
      await this.run(this.sql`SELECT 1`);
      return { state: "ok" };
    } catch (error) {
      return { state: "down", detail: `postgres: ${errorMessage(error)}` };
    }
  }

  async close(): Promise<void> {
    this.client = undefined;
    await this.runtime.dispose();
  }
}
