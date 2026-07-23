import { describe, expect, it } from "bun:test";
import { componentRef, principalId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { SessionStore } from "../../src/memory/session-store/index";
import { Scheduler } from "../../src/scheduler/index";
import { KernelContextManager } from "../../src/security/ifc/context-manager";

describe("G25 scheduler authority freshness", () => {
  it("resolves at fire time and leases concurrent ticks at most once", async () => {
    const records = new MemoryRecordAppender();
    const store = new SessionStore();
    let allowed = false;
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      authority: {
        async resolve() {
          return allowed;
        },
      },
      frames: {
        create() {
          return new KernelContextManager(
            records,
            {
              async sanitize() {
                return { approved: false };
              },
            },
          ).activeFrame;
        },
      },
      executor: {
        async execute() {
          executions += 1;
        },
      },
      records,
    });
    const common = {
      principal: principalId("principal"),
      agent: componentRef("workspace/agent/test"),
      requestedCapabilities: [{
        capability: "tool.execute",
        resources: ["workspace/tool/test"],
      }],
      runAt: new Date(0).toISOString(),
      payload: {},
    };
    await scheduler.schedule({ id: "revoked", ...common });
    expect((await scheduler.tick("daemon-a"))[0]?.type).toBe(
      "blocked-no-authority",
    );
    allowed = true;
    await scheduler.schedule({ id: "once", ...common });
    const results = await Promise.all([
      scheduler.tick("daemon-a"),
      scheduler.tick("daemon-b"),
    ]);
    expect(results.flat().filter((result) => result.type === "completed"))
      .toHaveLength(1);
    expect(executions).toBe(1);
    store.close();
  });
});
