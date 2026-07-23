import { describe, expect, it } from "bun:test";
import { AuditLog, MemoryCommitAdapter } from "../../src/audit/index";
import { AppendOnlyAuditSidecar } from "../../src/audit/sidecar";
import { scopeId } from "../../src/core/brands";

describe("G16 audit integrity", () => {
  it("hash-chains shards, cross-links their heads, and detects tampering", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    await log.append({
      type: "model.selection",
      scope: { level: "session", id: scopeId("session") },
      durability: "observational",
      classification: "internal",
      payload: { provider: "local" },
    });
    await log.append({
      type: "epoch.bump",
      scope: { level: "workspace", id: scopeId("workspace") },
      durability: "effect-gating",
      classification: "internal",
      payload: { next: 1 },
    });
    await log.crossLink();
    const snapshot = log.snapshot();
    expect(AuditLog.verify(snapshot)).toEqual({ valid: true, errors: [] });
    const [key, records] = Object.entries(snapshot.shards)[0] ?? [];
    const first = records?.[0];
    expect(key).toBeDefined();
    expect(first).toBeDefined();
    if (key === undefined || first === undefined) return;
    const corrupted = {
      ...snapshot,
      shards: {
        ...snapshot.shards,
        [key]: [
          { ...first, payload: { provider: "tampered" } },
          ...records.slice(1),
        ],
      },
    };
    expect(AuditLog.verify(corrupted).valid).toBe(false);
  });

  it("returns frozen records through an API with no mutation operations", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const record = await log.append({
      type: "registration.accepted",
      scope: { level: "organization", id: scopeId("org") },
      durability: "effect-gating",
      classification: "internal",
      payload: { ref: "tool/example" },
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(log).not.toHaveProperty("delete");
    expect(log).not.toHaveProperty("update");
  });

  it("exposes only append, cross-link, and snapshot through the sidecar", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const sidecar = new AppendOnlyAuditSidecar(log);
    await sidecar.append({
      type: "registration.accepted",
      scope: { level: "organization", id: scopeId("org") },
      durability: "effect-gating",
      classification: "internal",
      payload: { ref: "tool/example" },
    });
    const before = sidecar.snapshot();
    await sidecar.append({
      type: "registration.accepted",
      scope: { level: "organization", id: scopeId("org") },
      durability: "effect-gating",
      classification: "internal",
      payload: { ref: "tool/second" },
    });
    expect(Object.values(before.shards).flat()).toHaveLength(1);
    expect(Object.values(sidecar.snapshot().shards).flat()).toHaveLength(2);
    expect(sidecar).not.toHaveProperty("delete");
    expect(sidecar).not.toHaveProperty("update");
  });
});
