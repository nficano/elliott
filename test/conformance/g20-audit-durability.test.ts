import { describe, expect, it } from "bun:test";
import { AuditLog, MemoryCommitAdapter } from "../../src/audit/index";
import { scopeId } from "../../src/core/brands";

describe("G20 audit durability ordering", () => {
  it("commits effect-gating records before the dependent effect", async () => {
    const adapter = new MemoryCommitAdapter();
    const log = new AuditLog(adapter);
    let durableBeforeEffect = false;
    await log.executeAfterDurable(
      {
        type: "broker.dispatch",
        scope: { level: "invocation", id: scopeId("invocation") },
        durability: "effect-gating",
        classification: "confidential",
        payload: { target: "external" },
      },
      async () => {
        const record = Object.values(log.snapshot().shards).flat()[0];
        durableBeforeEffect = record !== undefined && adapter.has(record.id);
      },
    );
    expect(durableBeforeEffect).toBe(true);
  });

  it("bounds observational loss to the unflushed queue tail", async () => {
    const adapter = new MemoryCommitAdapter();
    const log = new AuditLog(adapter, 3);
    const first = await log.append({
      type: "cache.hit",
      scope: { level: "session", id: scopeId("session") },
      durability: "observational",
      classification: "internal",
      payload: {},
    });
    expect(adapter.has(first.id)).toBe(false);
    await log.flushObservational();
    expect(adapter.has(first.id)).toBe(true);
  });
});
