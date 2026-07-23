import type { Tier } from "../../core/types.js";

/**
 * Background job system (§14). Postgres queue: claim with
 * `SELECT … FOR UPDATE SKIP LOCKED … RETURNING`; `LISTEN/NOTIFY` for latency +
 * a slow poll sweep for durability. At-least-once + idempotency keys; expired
 * leases reclaimed on the next scan; poison quarantine after N attempts.
 */
export interface JobSpec {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly priority?: number; // lower = sooner; default 100
  readonly idempotencyKey?: string;
  readonly originConversation?: string;
  readonly runAfter?: Date;
}

export interface Job {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly originConversation?: string;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface JobQueue {
  enqueue(spec: JobSpec): Promise<string | undefined>; // undefined if idempotency-deduped
  /** Register a handler for a job kind. */
  handle(kind: string, handler: JobHandler): void;
  /** Start the worker pool + LISTEN + poll sweep. */
  start(): Promise<void>;
  stop(): Promise<void>;
  depth(): Promise<number>;
}

/** Delegation is a tool (§14): enqueue an isolated subagent, ack immediately. */
export interface DelegateSpec {
  readonly task: string;
  readonly tier?: Tier;
  readonly deadline?: string;
  readonly originConversation: string;
}

export interface JobQueueConfig {
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly pollMs: number;
  readonly maxAttempts: number;
}

export interface ClaimRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  origin_conversation: string | null;
}
