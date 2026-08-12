import { describe, expect, it } from "bun:test";
import { componentRef, principalId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import {
  InMemoryScheduledJobStore,
  Scheduler,
} from "../../src/scheduler/index";
import type { ScheduledJob } from "../../src/scheduler/types";
import { KernelContextManager } from "../../src/security/ifc/context-manager";

const job = (
  id: string,
  overrides: Partial<ScheduledJob> = {},
): ScheduledJob => ({
  id,
  principal: principalId("principal"),
  agent: componentRef("workspace/agent/test"),
  requestedCapabilities: [{
    capability: "tool.execute",
    resources: ["workspace/tool/test"],
  }],
  runAt: new Date(0).toISOString(),
  payload: {},
  ...overrides,
});

describe("InMemoryScheduledJobStore", () => {
  it("leases, completes, releases, and rejects duplicates", async () => {
    const store = new InMemoryScheduledJobStore(1000);
    await store.schedule(job("a"));
    await expect(store.schedule(job("a"))).rejects.toThrow("Duplicate");
    const now = new Date(1000);
    const leased = await store.leaseDue(now, "owner-a", 10);
    expect(leased.map((item) => item.job.id)).toEqual(["a"]);
    expect(await store.leaseDue(now, "owner-b", 10)).toEqual([]);
    await store.release("a", "owner-b");
    expect(await store.leaseDue(now, "owner-b", 10)).toEqual([]);
    await store.release("a", "owner-a");
    const releasable = await store.leaseDue(now, "owner-a", 10);
    expect(releasable).toHaveLength(1);
    await store.complete("a", "owner-b");
    await store.complete("a", "owner-a");
    expect(await store.leaseDue(now, "owner-a", 10)).toEqual([]);
  });

  it("reschedules recurring jobs on success and failure", async () => {
    const store = new InMemoryScheduledJobStore();
    const records = new MemoryRecordAppender();
    let shouldFail = true;
    const scheduler = new Scheduler({
      store,
      authority: {
        async resolve() {
          return true;
        },
      },
      frames: {
        create() {
          return new KernelContextManager(records, {
            async sanitize() {
              return { approved: false };
            },
          }).activeFrame;
        },
      },
      executor: {
        async execute() {
          if (shouldFail) throw new Error("boom");
        },
      },
      records,
    });
    await scheduler.schedule(job("retry", {
      recurrence: {
        cron: "0 0 * * *",
        maximumRetryAttempts: 2,
        failureBackoffMilliseconds: 1000,
        maximumBackoffMilliseconds: 60_000,
      },
    }));
    const failed = await scheduler.tick("owner", new Date(0));
    expect(failed[0]?.type).toBe("failed");
    shouldFail = false;
    const recovered = await scheduler.tick(
      "owner",
      new Date(2000),
    );
    expect(recovered[0]?.type).toBe("completed");
    const next = await store.leaseDue(
      new Date("2100-01-02T00:00:00.000Z"),
      "owner",
      10,
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.job.retryAttempt).toBe(0);
  });
});
