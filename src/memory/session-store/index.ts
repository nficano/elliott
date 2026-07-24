import { Database } from "bun:sqlite";
import { componentRef, principalId } from "../../core/brands";
import type {
  LeasedJob,
  ScheduledJob,
  ScheduledJobStore,
} from "../../scheduler/types";
import type {
  ScheduledJobRow,
  SessionAnalytics,
  SessionMessage,
  SessionRecord,
  SessionUsage,
} from "../types";
import { SessionEvolutionStore } from "./evolution";
import {
  migrateScheduledJobs,
  parseCapabilities,
  parsePayload,
  parseRecurrence,
} from "./scheduler-codec";

const DEFAULT_LEASE_MILLISECONDS = 60_000;

const SCHEMA = [
  "PRAGMA journal_mode = WAL",
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, principal TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, classification TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS model_usage (session_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL)",
  "CREATE TABLE IF NOT EXISTS gateway_routing (route_key TEXT PRIMARY KEY, session_id TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS delegation_state (delegation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, principal TEXT NOT NULL, agent TEXT NOT NULL, requested_capabilities TEXT NOT NULL, run_at TEXT NOT NULL, payload TEXT NOT NULL, recurrence TEXT, retry_attempt INTEGER, lease_owner TEXT, lease_until TEXT)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(id UNINDEXED, session_id UNINDEXED, content, tokenize='trigram')",
  "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_cjk USING fts5(id UNINDEXED, session_id UNINDEXED, content, tokenize='unicode61')",
];

export class SessionStore implements ScheduledJobStore {
  readonly #database: Database;
  readonly #leaseMilliseconds: number;
  readonly evolution: SessionEvolutionStore;

  constructor(
    filename = ":memory:",
    leaseMilliseconds = DEFAULT_LEASE_MILLISECONDS,
  ) {
    this.#database = new Database(filename, { create: true, strict: true });
    this.#leaseMilliseconds = leaseMilliseconds;
    for (const statement of SCHEMA) this.#database.run(statement);
    migrateScheduledJobs(this.#database);
    this.evolution = new SessionEvolutionStore(this.#database);
  }

  createSession(session: SessionRecord): void {
    this.#database.run(
      "INSERT INTO sessions (id, source, principal, parent_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        session.id,
        session.source,
        session.principal,
        session.parentId ?? null,
        session.createdAt,
      ],
    );
  }

  appendMessage(message: SessionMessage): void {
    const insert = this.#database.transaction(() => {
      this.#database.run(
        "INSERT INTO messages (id, session_id, role, content, classification, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.classification,
          message.createdAt,
        ],
      );
      this.#database.run(
        "INSERT INTO messages_fts_trigram (id, session_id, content) VALUES (?, ?, ?)",
        [message.id, message.sessionId, message.content],
      );
      this.#database.run(
        "INSERT INTO messages_fts_cjk (id, session_id, content) VALUES (?, ?, ?)",
        [message.id, message.sessionId, message.content],
      );
    });
    insert();
  }

  recordUsage(usage: SessionUsage): void {
    this.#database.run(
      "INSERT INTO model_usage (session_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)",
      [
        usage.sessionId,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsd,
      ],
    );
  }

  search(query: string, cjk = false): readonly SessionMessage[] {
    const table = cjk ? "messages_fts_cjk" : "messages_fts_trigram";
    return this.#database.query<SessionMessage, [string]>(
      `SELECT m.id, m.session_id AS sessionId, m.role, m.content, m.classification, m.created_at AS createdAt FROM ${table} f JOIN messages m ON m.id = f.id WHERE ${table} MATCH ? ORDER BY rank`,
    ).all(query);
  }

  analytics(): SessionAnalytics {
    const result = this.#database.query<SessionAnalytics, []>(
      "SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM messages) AS messages, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cost_usd), 0) AS costUsd FROM model_usage",
    ).get();
    return result ?? {
      sessions: 0,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  setGatewayRoute(routeKey: string, sessionId: string): void {
    this.#database.run(
      "INSERT INTO gateway_routing (route_key, session_id) VALUES (?, ?) ON CONFLICT(route_key) DO UPDATE SET session_id = excluded.session_id",
      [routeKey, sessionId],
    );
  }

  gatewaySession(routeKey: string): string | undefined {
    const row = this.#database.query<{ readonly sessionId: string; }, [string]>(
      "SELECT session_id AS sessionId FROM gateway_routing WHERE route_key = ?",
    ).get(routeKey);
    return row?.sessionId;
  }

  setDelegation(delegationId: string, sessionId: string, state: string): void {
    this.#database.run(
      "INSERT INTO delegation_state (delegation_id, session_id, state) VALUES (?, ?, ?) ON CONFLICT(delegation_id) DO UPDATE SET state = excluded.state",
      [delegationId, sessionId, state],
    );
  }

  async schedule(job: ScheduledJob): Promise<void> {
    this.#database.run(
      "INSERT INTO scheduled_jobs (id, principal, agent, requested_capabilities, run_at, payload, recurrence, retry_attempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        job.id,
        job.principal,
        job.agent,
        JSON.stringify(job.requestedCapabilities),
        job.runAt,
        JSON.stringify(job.payload),
        job.recurrence === undefined
          ? null
          : JSON.stringify(job.recurrence),
        job.retryAttempt ?? null,
      ],
    );
  }

  async scheduleIfAbsent(job: ScheduledJob): Promise<boolean> {
    const exists = this.#database.query<{ readonly id: string; }, [string]>(
      "SELECT id FROM scheduled_jobs WHERE id = ?",
    ).get(job.id);
    if (exists !== null) return false;
    await this.schedule(job);
    return true;
  }

  async replaceScheduledIfPayloadChanged(
    job: ScheduledJob,
  ): Promise<boolean> {
    const current = this.#database.query<
      { readonly payload: string; readonly leaseOwner: string | null; },
      [string]
    >(
      "SELECT payload, lease_owner AS leaseOwner FROM scheduled_jobs WHERE id = ?",
    ).get(job.id);
    if (current === null) {
      await this.schedule(job);
      return true;
    }
    if (current.payload === JSON.stringify(job.payload)) return false;
    if (current.leaseOwner !== null) return false;
    this.#database.run(
      "UPDATE scheduled_jobs SET principal = ?, agent = ?, requested_capabilities = ?, run_at = ?, payload = ?, recurrence = ?, retry_attempt = ?, lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner IS NULL",
      [
        job.principal,
        job.agent,
        JSON.stringify(job.requestedCapabilities),
        job.runAt,
        JSON.stringify(job.payload),
        job.recurrence === undefined
          ? null
          : JSON.stringify(job.recurrence),
        job.retryAttempt ?? null,
        job.id,
      ],
    );
    return true;
  }

  async leaseDue(
    now: Date,
    owner: string,
    limit: number,
  ): Promise<readonly LeasedJob[]> {
    const nowValue = now.toISOString();
    const rows = this.#database.query<
      ScheduledJobRow,
      [string, string, number]
    >(
      "SELECT id, principal, agent, requested_capabilities AS requestedCapabilities, run_at AS runAt, payload, recurrence, retry_attempt AS retryAttempt FROM scheduled_jobs WHERE run_at <= ? AND (lease_until IS NULL OR lease_until <= ?) ORDER BY run_at LIMIT ?",
    ).all(nowValue, nowValue, limit);
    const leases: LeasedJob[] = [];
    for (const row of rows) {
      const leaseUntil = new Date(
        now.getTime() + this.#leaseMilliseconds,
      ).toISOString();
      const changed = this.#database.run(
        "UPDATE scheduled_jobs SET lease_owner = ?, lease_until = ? WHERE id = ? AND (lease_until IS NULL OR lease_until <= ?)",
        [owner, leaseUntil, row.id, nowValue],
      ).changes;
      if (changed === 0) continue;
      const recurrence = parseRecurrence(row.recurrence);
      leases.push(Object.freeze({
        owner,
        leaseUntil,
        job: Object.freeze({
          id: row.id,
          principal: principalId(row.principal),
          agent: componentRef(row.agent),
          requestedCapabilities: parseCapabilities(row.requestedCapabilities),
          runAt: row.runAt,
          payload: parsePayload(row.payload),
          ...(recurrence !== undefined && { recurrence }),
          ...(row.retryAttempt !== null && {
            retryAttempt: row.retryAttempt,
          }),
        }),
      }));
    }
    return leases;
  }

  async complete(jobId: string, owner: string): Promise<void> {
    this.#database.run(
      "DELETE FROM scheduled_jobs WHERE id = ? AND lease_owner = ?",
      [jobId, owner],
    );
  }

  async release(jobId: string, owner: string): Promise<void> {
    this.#database.run(
      "UPDATE scheduled_jobs SET lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ?",
      [jobId, owner],
    );
  }

  close(): void {
    this.#database.close();
  }
}
