import type * as PgClient from "@effect/sql-pg/PgClient";
import { Cron } from "croner";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import {
  addScopeFinalizer,
  ignorePromiseFailure,
  repeatAfter,
} from "../../core/recurring-worker.js";
import type { ReservedConnection, StorePort } from "../../store/types.js";
import type { JobQueue } from "../jobs/types.js";
import type { Observability } from "../observability/types.js";
import type { ScheduleSpec } from "../registry/types.js";
import { AdvisoryLockRowsSchema } from "./schema.js";
import type { DueRow, Scheduler, SchedulerConfig } from "./types.js";

/**
 * Scheduler (§15). Durable cron persisted in Postgres with `next_fire`.
 * Single-owner via `pg_advisory_lock` held on a reserved physical pool
 * connection for the lock's full lifetime — this is what fixes the oslo
 * fribbles_bot 409 duplicate-poller bug. `hashtextextended` uses the full 64-bit
 * keyspace; a `sched:` prefix keeps unrelated subsystems from colliding.
 * Clock skew/DST across a restart is handled by `croner` computing `next_fire`
 * from wall-clock, not shell/interval math. A fired schedule enqueues a
 * `sched:<id>` job (durable + retryable); the job system runs it.
 */
const LOCK_KEY = "sched:scheduler";
const OWNER_ACQUIRE_INTERVAL_MS = 30_000;
const DEFAULT_TICK_INTERVAL_MS = 20_000;
const CRON_FALLBACK_DELAY_MS = 3_600_000;

export class PgScheduler implements Scheduler {
  private readonly specs = new Map<string, ScheduleSpec>();
  private reserved: ReservedConnection | undefined;
  private owner = false;
  private workerScope: Scope.Closeable | undefined;

  constructor(
    private readonly store: StorePort,
    private readonly obs: Observability,
    private readonly jobs: JobQueue,
    private readonly cfg: SchedulerConfig,
  ) {}

  private get sql(): PgClient.PgClient {
    return this.store.sql;
  }

  register(spec: ScheduleSpec): void {
    this.specs.set(spec.id, spec);
  }

  async start(): Promise<void> {
    if (this.workerScope) return;
    const scope = await Effect.runPromise(Scope.make());
    this.workerScope = scope;
    try {
      // Persist/refresh each schedule's next_fire (durable, §15).
      for (const spec of this.specs.values()) {
        const next = this.nextFrom(spec.cron, new Date());
        await this.store.run(this.sql`
          INSERT INTO schedule (id, cron, next_fire, catchup)
          VALUES (${spec.id}, ${spec.cron}, ${next.toISOString()}, ${
          spec.catchup ?? "skip"
        })
          ON CONFLICT (id) DO UPDATE
          SET cron = EXCLUDED.cron, catchup = EXCLUDED.catchup`);
      }
      addScopeFinalizer(scope, this.releaseOwnershipEffect());
      await this.tryBecomeOwner(scope);
      // Keep trying to become owner if another process currently holds the lock.
      await Effect.runPromise(
        Effect.forkIn(
          repeatAfter(
            this.acquireOwnershipEffect(scope),
            OWNER_ACQUIRE_INTERVAL_MS,
          ),
          scope,
        ),
      );
    } catch (error) {
      this.workerScope = undefined;
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    }
  }

  private async tryBecomeOwner(scope: Scope.Scope): Promise<void> {
    if (this.owner) return;
    if (!this.reserved) this.reserved = await this.store.reserve();
    const rows = await this.store.run(
      Effect.flatMap(
        this.reserved.connection.execute(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
          [LOCK_KEY],
          undefined,
        ),
        Schema.decodeUnknownEffect(AdvisoryLockRowsSchema),
      ),
    );
    if (rows[0]?.locked) {
      this.owner = true;
      this.obs.counter("agentkit.scheduler.owner", 1);
      const tickMs = this.cfg.tickMs ?? DEFAULT_TICK_INTERVAL_MS;
      const ticking = this.tickEffect().pipe(
        Effect.flatMap((alive) => alive ? Effect.void : Effect.fail(undefined)),
        Effect.repeat({ schedule: Schedule.spaced(tickMs) }),
        Effect.catch(() => Effect.void),
      );
      await Effect.runPromise(Effect.forkIn(ticking, scope));
    } else {
      // Standby: release the reserved connection so we don't hold one idle.
      await this.reserved.release();
      this.reserved = undefined;
    }
  }

  private async tick(): Promise<boolean> {
    if (!this.owner) return false;
    const reserved = this.reserved;
    if (!reserved) {
      this.owner = false;
      return false;
    }
    // Liveness check on the lock connection (§15) — a dead conn drops the lock.
    if (!(await this.lockConnectionAlive(reserved))) {
      this.owner = false;
      this.reserved = undefined;
      return false;
    }

    const due = await this.store.run(
      this.sql<DueRow>`
        SELECT id, cron, next_fire, catchup
        FROM schedule WHERE next_fire <= now()`,
    );
    for (const row of due) {
      const spec = this.specs.get(row.id);
      if (!spec) continue;
      // Idempotency-keyed on the fire time so a catch-up double can't double-run (§14).
      await this.jobs.enqueue({
        kind: `sched:${row.id}`,
        payload: {
          scheduleId: row.id,
          ...(spec.script && { script: spec.script }),
          firedAt: row.next_fire.toISOString(),
        },
        idempotencyKey: `sched:${row.id}:${row.next_fire.toISOString()}`,
        ...(spec.deliverTo && { originConversation: spec.deliverTo.join(",") }),
      });
      const from = row.catchup === "catchup" ? row.next_fire : new Date();
      const next = this.nextFrom(row.cron, from);
      await this.store.run(
        this.sql`
          UPDATE schedule
          SET next_fire = ${next.toISOString()}, last_fired = now()
          WHERE id = ${row.id}`,
      );
      this.obs.counter("agentkit.scheduler.fired", 1, {
        "agentkit.component.id": row.id,
      });
    }
    return true;
  }

  private async lockConnectionAlive(
    reserved: ReservedConnection,
  ): Promise<boolean> {
    try {
      await this.store.run(
        reserved.connection.execute("SELECT 1", [], undefined),
      );
      return true;
    } catch {
      await reserved.release().catch(() => {});
      return false;
    }
  }

  private readonly acquireOwnershipEffect = Effect.fn(
    "PgScheduler.acquireOwnership",
  )(
    { self: this },
    function*(this: PgScheduler, scope: Scope.Scope) {
      yield* ignorePromiseFailure(() => this.tryBecomeOwner(scope));
    },
  );

  private readonly tickEffect = Effect.fn("PgScheduler.tick")(
    { self: this },
    function*(this: PgScheduler) {
      return yield* Effect.tryPromise({
        try: () => this.tick(),
        catch: () => undefined,
      }).pipe(
        Effect.catch(() => Effect.succeed(true)),
        Effect.uninterruptible,
      );
    },
  );

  private nextFrom(cron: string, from: Date): Date {
    const next = new Cron(cron, { timezone: this.cfg.timezone }).nextRun(from);
    // Fallback an hour out if the expression yields nothing (never wedge).
    return next ?? new Date(from.getTime() + CRON_FALLBACK_DELAY_MS);
  }

  async upcoming(): Promise<{ id: string; nextFire: string; }[]> {
    const rows = await this.store.run(
      this.sql<{ id: string; next_fire: Date; }>`
        SELECT id, next_fire FROM schedule ORDER BY next_fire`,
    );
    return rows.map((r) => ({ id: r.id, nextFire: r.next_fire.toISOString() }));
  }

  async stop(): Promise<void> {
    const scope = this.workerScope;
    this.workerScope = undefined;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  }

  private async releaseOwnership(): Promise<void> {
    const reserved = this.reserved;
    const owner = this.owner;
    this.reserved = undefined;
    this.owner = false;
    if (!reserved) return;
    if (owner) {
      await this.store.run(
        reserved.connection.execute(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [LOCK_KEY],
          undefined,
        ).pipe(Effect.catch(() => Effect.void)),
      );
    }
    await reserved.release();
  }

  private readonly releaseOwnershipEffect = Effect.fn(
    "PgScheduler.releaseOwnership",
  )(
    { self: this },
    function*(this: PgScheduler) {
      yield* Effect.promise(() => this.releaseOwnership()).pipe(
        Effect.uninterruptible,
      );
    },
  );
}
