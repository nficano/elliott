import { scopeId } from "../core/brands";
import type { LeasedJob, ScheduledJob, ScheduledJobStore } from "./types";
import type { ScheduledRunResult, SchedulerDependencies } from "./types";

const DEFAULT_LEASE_MILLISECONDS = 60_000;
const DEFAULT_TICK_LIMIT = 64;

export class InMemoryScheduledJobStore implements ScheduledJobStore {
  readonly #jobs = new Map<string, ScheduledJob>();
  readonly #leases = new Map<string, LeasedJob>();
  readonly #leaseMilliseconds: number;

  constructor(leaseMilliseconds = DEFAULT_LEASE_MILLISECONDS) {
    this.#leaseMilliseconds = leaseMilliseconds;
  }

  async schedule(job: ScheduledJob): Promise<void> {
    if (this.#jobs.has(job.id)) {
      throw new Error(`Duplicate scheduled job ${job.id}`);
    }
    this.#jobs.set(job.id, Object.freeze(job));
  }

  async leaseDue(
    now: Date,
    owner: string,
    limit: number,
  ): Promise<readonly LeasedJob[]> {
    const leased: LeasedJob[] = [];
    for (const job of this.#jobs.values()) {
      if (leased.length >= limit || new Date(job.runAt) > now) continue;
      const current = this.#leases.get(job.id);
      if (current !== undefined && new Date(current.leaseUntil) > now) continue;
      const lease: LeasedJob = Object.freeze({
        job,
        owner,
        leaseUntil: new Date(now.getTime() + this.#leaseMilliseconds)
          .toISOString(),
      });
      this.#leases.set(job.id, lease);
      leased.push(lease);
    }
    return leased;
  }

  async complete(jobId: string, owner: string): Promise<void> {
    if (this.#leases.get(jobId)?.owner !== owner) return;
    this.#leases.delete(jobId);
    this.#jobs.delete(jobId);
  }

  async release(jobId: string, owner: string): Promise<void> {
    if (this.#leases.get(jobId)?.owner === owner) this.#leases.delete(jobId);
  }
}

export class Scheduler {
  readonly #dependencies: SchedulerDependencies;

  constructor(dependencies: SchedulerDependencies) {
    this.#dependencies = dependencies;
  }

  schedule(job: ScheduledJob): Promise<void> {
    return this.#dependencies.store.schedule(job);
  }

  async tick(
    owner: string,
    now = new Date(),
  ): Promise<readonly ScheduledRunResult[]> {
    const leases = await this.#dependencies.store.leaseDue(
      now,
      owner,
      DEFAULT_TICK_LIMIT,
    );
    return Promise.all(leases.map((lease) => this.#fire(lease)));
  }

  async #fire(lease: LeasedJob): Promise<ScheduledRunResult> {
    const job = lease.job;
    const allowed = await this.#dependencies.authority.resolve(
      job.principal,
      job.requestedCapabilities,
    );
    if (!allowed) {
      await this.#record(
        job,
        "scheduler.blocked-no-authority",
        "observational",
      );
      await this.#dependencies.store.complete(job.id, lease.owner);
      return Object.freeze({ jobId: job.id, type: "blocked-no-authority" });
    }
    const frame = this.#dependencies.frames.create();
    try {
      await this.#record(job, "scheduler.fire", "effect-gating");
      await this.#dependencies.executor.execute(job, frame);
      await this.#dependencies.store.complete(job.id, lease.owner);
      return Object.freeze({ jobId: job.id, type: "completed", frame });
    } catch (error) {
      void error;
      await this.#dependencies.store.release(job.id, lease.owner);
      return Object.freeze({ jobId: job.id, type: "failed", frame });
    }
  }

  async #record(
    job: ScheduledJob,
    type: string,
    durability: "effect-gating" | "observational",
  ): Promise<void> {
    await this.#dependencies.records.append({
      type,
      scope: { level: "principal", id: scopeId(job.principal) },
      durability,
      classification: "internal",
      payload: {
        jobId: job.id,
        agent: job.agent,
        requestedCapabilities: job.requestedCapabilities.map((item) =>
          item.capability
        ),
      },
    });
  }
}

export type * from "./types";
