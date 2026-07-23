import type * as PgClient from "@effect/sql-pg/PgClient";
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as SqlConnection from "effect/unstable/sql/SqlConnection";
import { PgFootprintLedger } from "../src/host/footprint/ledger.js";
import { PgJobQueue } from "../src/host/jobs/queue.js";
import type { JobQueue } from "../src/host/jobs/types.js";
import type { Observability } from "../src/host/observability/types.js";
import { PgScheduler } from "../src/host/scheduler/scheduler.js";
import type { ReservedConnection, StorePort } from "../src/store/types.js";

const obs: Observability = {
  span: (_name, _attrs, operation) =>
    operation({
      setAttrs: () => {},
      setError: () => {},
      end: () => {},
    }),
  startSpan: () => ({
    setAttrs: () => {},
    setError: () => {},
    end: () => {},
  }),
  counter: () => {},
  histogram: () => {},
  gauge: () => {},
  recordError: () => {},
  currentTraceId: () => "",
  shutdown: async () => {},
};

describe("recurring worker lifecycle", () => {
  test("job queue scope unsubscribes LISTEN on stop", async () => {
    let unlistens = 0;
    const { promise: started, resolve: markStarted } = Promise
      .withResolvers<void>();
    const sql = querySql(() => [], {
      listen: () =>
        Stream.callback(() =>
          Effect.acquireRelease(
            Effect.sync(markStarted),
            () =>
              Effect.sync(() => {
                unlistens++;
              }),
          )
        ),
    });
    const store = makeStore(sql);
    const queue = new PgJobQueue(store, obs, {
      concurrency: 1,
      leaseMs: 1000,
      pollMs: 60_000,
      maxAttempts: 1,
    });

    await queue.start();
    await started;
    await queue.stop();

    expect(unlistens).toBe(1);
  });

  test("scheduler scope unlocks and releases its reserved connection", async () => {
    let locks = 0;
    let unlocks = 0;
    let releases = 0;
    const pooledSql = querySql(() => []);
    const reservedConnection = queryConnection((text) => {
      if (text.includes("pg_try_advisory_lock")) {
        locks++;
        return [{ locked: true }];
      }
      if (text.includes("pg_advisory_unlock")) unlocks++;
      return [];
    });
    const reserved: ReservedConnection = {
      connection: reservedConnection,
      scope: Scope.makeUnsafe(),
      release: async () => {
        releases++;
      },
    };
    const store = makeStore(pooledSql, async () => reserved);
    const jobs: JobQueue = {
      enqueue: async () => undefined,
      handle: () => {},
      start: async () => {},
      stop: async () => {},
      depth: async () => 0,
    };
    const scheduler = new PgScheduler(store, obs, jobs, {
      timezone: "UTC",
      tickMs: 60_000,
    });

    await scheduler.start();
    await scheduler.stop();

    expect(locks).toBe(1);
    expect(unlocks).toBe(1);
    expect(releases).toBe(1);
  });

  test("ledger scope interrupts its cadence before the final flush", async () => {
    let writes = 0;
    const sql = querySql((text) => {
      if (text.includes("INSERT INTO footprint_ledger")) writes++;
      return [];
    });
    const ledger = new PgFootprintLedger(makeStore(sql), obs, 60_000);
    await ledger.recordDynamic({
      componentId: "test",
      toolMs: 1,
      inTokensEst: 2,
      outTokensEst: 3,
      usdEst: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      error: false,
    });

    await ledger.start();
    await ledger.stop();

    expect(writes).toBe(1);
    expect(await ledger.report()).toEqual([]);
  });
});

function querySql(
  respond: (text: string) => unknown[],
  overrides: {
    readonly listen?: PgClient.PgClient["listen"];
  } = {},
): PgClient.PgClient {
  const query = (strings: TemplateStringsArray) => {
    return Effect.succeed(respond(strings.join("?")));
  };
  return Object.assign(query, {
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    listen: overrides.listen ?? (() => Stream.never),
    notify: () => Effect.void,
    json: (value: unknown) => value,
    insert: (value: unknown) => value,
  }) as unknown as PgClient.PgClient;
}

function queryConnection(
  respond: (text: string) => unknown[],
): SqlConnection.Connection {
  const execute = (sql: string) => Effect.succeed(respond(sql));
  return {
    execute,
    executeRaw: execute,
    executeStream: (sql) => Stream.fromIterable(respond(sql)),
    executeValues: () => Effect.succeed([]),
    executeValuesUnprepared: () => Effect.succeed([]),
    executeUnprepared: execute,
  };
}

function makeStore(
  sql: PgClient.PgClient,
  reserve: () => Promise<ReservedConnection> = async () => ({
    connection: queryConnection(() => []),
    scope: Scope.makeUnsafe(),
    release: async () => {},
  }),
): StorePort {
  return {
    sql,
    run: (effect) => Effect.runPromise(effect),
    reserve,
    now: () => Effect.succeed(new Date(0)),
    health: async () => ({ state: "ok" }),
  };
}
