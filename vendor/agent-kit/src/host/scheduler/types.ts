import type { NotifyPort } from "../../core/notify/types.js";
import type { JobQueue } from "../jobs/types.js";
import type { ErrorReporter } from "../observability/types.js";
import type { ScheduleSpec } from "../registry/types.js";
import type { RuntimeApi } from "../runtime/types.js";

/**
 * Scheduler (§15). Durable cron persisted in Postgres with `next_fire`.
 * Single-owner via `pg_advisory_lock` on a dedicated non-pooled connection.
 * Catch-up policy per schedule; clock skew/DST handled by a real tz lib
 * (`croner`) computing `next_fire` from wall-clock, not shell/interval math.
 * `[SILENT]` sentinel suppresses notification (§15).
 */
export interface Scheduler {
  register(spec: ScheduleSpec): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The next fire times (for /control status). */
  upcoming(): Promise<{ id: string; nextFire: string; }[]>;
}

export const SILENT_SENTINEL = "[SILENT]";

export interface SchedulerConfig {
  readonly timezone: string;
  readonly tickMs?: number;
}

export interface DueRow {
  id: string;
  cron: string;
  next_fire: Date;
  catchup: string;
}

export interface RotaTask {
  readonly title: string;
  readonly prompt: string;
}

export interface RotaSlot {
  readonly task?: RotaTask;
  /** Every-other-week pair: even ISO-ish week → [0], odd → [1]. */
  readonly alternate?: readonly [RotaTask, RotaTask];
}

export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;
export const FRIDAY = 5;
export type Weekday =
  | typeof MONDAY
  | typeof TUESDAY
  | typeof WEDNESDAY
  | typeof THURSDAY
  | typeof FRIDAY;

/** Keys are 1 (Monday) … 5 (Friday); weekends are implicitly null. */
export type RotaPlan = Readonly<Partial<Record<Weekday, RotaSlot>>>;

export interface ScheduleHandlerOptions {
  readonly jobs: JobQueue;
  readonly runtime: RuntimeApi;
  readonly notify: NotifyPort | undefined;
  readonly schedules: ScheduleSpec[];
  /** GlitchTip capture at the schedule seam (§12); absent in bare tests. */
  readonly reporter?: ErrorReporter;
}

export interface ScheduledRunOptions {
  readonly runtime: RuntimeApi;
  readonly notify: NotifyPort | undefined;
  readonly spec: ScheduleSpec;
  readonly reporter?: ErrorReporter;
}
