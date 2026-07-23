import type * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { errorMessage } from "../../core/errors.js";
import { Semaphore } from "../../core/llm/semaphore.js";
import {
  ignorePromiseFailure,
  repeatAfter,
} from "../../core/recurring-worker.js";
import { encodeJson } from "../../store/json.js";
import type { StorePort } from "../../store/types.js";
import { noopReporter } from "../observability/glitchtip.js";
import type { ErrorReporter, Observability } from "../observability/types.js";
import type {
  ClaimRow,
  Job,
  JobHandler,
  JobQueue,
  JobQueueConfig,
  JobSpec,
} from "./types.js";

const DEFAULT_JOB_PRIORITY = 100;
const MILLISECONDS_PER_SECOND = 1000;
const LISTEN_RETRY_MS = 1000;
const MAX_RETRY_BACKOFF_SECONDS = 300;
const BASE_RETRY_BACKOFF_SECONDS = 5;

/**
 * Background job system (§14). Claim with `SELECT … FOR UPDATE SKIP LOCKED …
 * RETURNING` — the most battle-tested queue primitive there is. `LISTEN/NOTIFY`
 * wakes workers for latency; a slow poll sweep is the durability backstop
 * (a NOTIFY fired while a worker is down is gone). Postgres `now()` is the clock
 * authority for `run_after`/`lease_expires_at` (§20). At-least-once +
 * idempotency; expired leases reclaimed on the next scan; poison quarantine after
 * N attempts.
 */
export class PgJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly gate: Semaphore;
  private running = false;
  private workerScope: Scope.Closeable | undefined;

  constructor(
    private readonly store: StorePort,
    private readonly obs: Observability,
    private readonly cfg: JobQueueConfig,
    private readonly reporter: ErrorReporter = noopReporter,
  ) {
    this.gate = new Semaphore(cfg.concurrency);
  }

  private get sql(): PgClient.PgClient {
    return this.store.sql;
  }

  handle(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(spec: JobSpec): Promise<string | undefined> {
    const sql = this.sql;
    const runAfter = spec.runAfter ?? sql`now()`;
    const rows = await this.store.run(sql<{ id: string; }>`
      INSERT INTO jobs (kind, payload, priority, idempotency_key, origin_conversation, run_after)
      VALUES (${spec.kind}, ${sql.json(encodeJson(spec.payload))}, ${
      spec.priority ?? DEFAULT_JOB_PRIORITY
    },
              ${spec.idempotencyKey ?? null}, ${
      spec.originConversation ?? null
    },
              ${runAfter})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);
    const id = rows[0]?.id;
    if (id) await this.store.run(sql.notify("jobs", id));
    return id; // undefined = idempotency-deduped (§14)
  }

  async start(): Promise<void> {
    if (this.workerScope) return;
    const scope = await Effect.runPromise(Scope.make());
    this.workerScope = scope;
    this.running = true;
    try {
      // LISTEN is scoped to a physical connection. Retrying the whole stream
      // reacquires and re-subscribes after connection loss.
      const listen = this.sql.listen("jobs").pipe(
        Stream.retry(Schedule.spaced(LISTEN_RETRY_MS)),
        Stream.runForEach(() =>
          Effect.sync(() => {
            this.forkDrain(scope);
          })
        ),
      );
      await Effect.runPromise(Effect.forkIn(listen, scope));
      // Slow poll sweep = durability backstop; also reclaims expired leases.
      await Effect.runPromise(
        Effect.forkIn(repeatAfter(this.sweepEffect(), this.cfg.pollMs), scope),
      );
      this.forkDrain(scope);
    } catch (error) {
      this.running = false;
      this.workerScope = undefined;
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    const scope = this.workerScope;
    this.workerScope = undefined;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  }

  async depth(): Promise<number> {
    const rows = await this.store.run(
      this.sql<{ n: number; }>`
        SELECT count(*)::int AS n FROM jobs WHERE status = 'ready'`,
    );
    return rows[0]?.n ?? 0;
  }

  private async sweep(): Promise<void> {
    // Reclaim leases that expired (crash recovery, §14) — Postgres now() authority.
    await this.store.run(this.sql`
      UPDATE jobs SET status = 'ready'
      WHERE status = 'leased' AND lease_expires_at < now()`.pipe(
      Effect.catch(() => Effect.void),
    ));
    await this.drain();
  }

  private readonly sweepEffect = Effect.fn("PgJobQueue.sweep")(
    { self: this },
    function*(this: PgJobQueue) {
      yield* ignorePromiseFailure(() => this.sweep());
    },
  );

  private readonly drainEffect = Effect.fn("PgJobQueue.drain")(
    { self: this },
    function*(this: PgJobQueue) {
      yield* ignorePromiseFailure(() => this.drain());
    },
  );

  private forkDrain(scope: Scope.Scope): void {
    void Effect.runPromise(Effect.forkIn(this.drainEffect(), scope));
  }

  /** Claim + run jobs until the pool is full or nothing is ready. */
  private async drain(): Promise<void> {
    if (!this.running) return;
    while (this.running && this.gate.depth === 0) {
      const job = await this.claim();
      if (!job) break;
      // Run under the concurrency gate; don't await (fills the pool).
      void this.gate.run(() => this.execute(job));
    }
  }

  private async claim(): Promise<Job | undefined> {
    const sql = this.sql;
    const leaseSeconds = this.cfg.leaseMs / MILLISECONDS_PER_SECOND;
    return this.store.run(sql.withTransaction(Effect.gen(function*() {
      const rows = yield* sql<ClaimRow>`
        SELECT id, kind, payload, attempts, origin_conversation
        FROM jobs
        WHERE status = 'ready' AND run_after <= now()
        ORDER BY priority, run_after
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return;
      yield* sql`
        UPDATE jobs
        SET status = 'leased', attempts = attempts + 1,
            lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
        WHERE id = ${row.id}
      `;
      const job: Job = {
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts + 1,
        ...(row.origin_conversation
          && { originConversation: row.origin_conversation }),
      };
      return job;
    })));
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      await this.fail(job, `no handler for kind '${job.kind}'`);
      return;
    }
    try {
      await this.obs.span(
        "agentkit.job",
        { "agentkit.job.kind": job.kind, "agentkit.job.attempt": job.attempts },
        () => handler(job),
      );
      await this.store.run(
        this.sql`UPDATE jobs SET status = 'done' WHERE id = ${job.id}`,
      );
    } catch (error) {
      // Innermost seams (turn/tool/spec) captured first; identity-dedupe in the
      // reporter makes this the catch-all for un-captured handler failures.
      this.reporter.captureException(error, {
        mechanism: "job",
        handled: true,
        tags: { job: job.kind, component: "jobs" },
        extra: { job_id: job.id, attempt: job.attempts },
      });
      await this.fail(job, errorMessage(error));
    } finally {
      void this.drain(); // a freed slot may pick up more work
    }
  }

  private async fail(job: Job, error: string): Promise<void> {
    if (job.attempts >= this.cfg.maxAttempts) {
      // Poison quarantine after N attempts (§14).
      await this.store.run(
        this.sql`
          UPDATE jobs SET status = 'dead', last_error = ${error}
          WHERE id = ${job.id}`,
      );
      this.obs.recordError("ToolError", `job ${job.kind} dead: ${error}`, {
        "agentkit.job.kind": job.kind,
      });
    } else {
      const backoffSec = Math.min(
        MAX_RETRY_BACKOFF_SECONDS,
        BASE_RETRY_BACKOFF_SECONDS * 2 ** job.attempts,
      );
      await this.store.run(this.sql`
        UPDATE jobs
        SET status = 'ready', last_error = ${error},
            run_after = now() + make_interval(secs => ${backoffSec})
        WHERE id = ${job.id}`);
    }
  }
}
