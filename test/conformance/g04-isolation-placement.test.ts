import { describe, expect, it } from "bun:test";
import { digest, scopeId } from "../../src/core/brands";
import { IsolationFloorError } from "../../src/core/errors";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { assertIsolation } from "../../src/placement/isolation";
import { PlacementManager } from "../../src/placement/pools/index";
import type {
  PlacementRequest,
  SecurityContext,
} from "../../src/placement/types";
import { makeManifest } from "../helpers";

const context = (securityCritical = false): SecurityContext => ({
  effectiveCeilingDigest: digest("ceiling"),
  maximumClassification: "internal",
  trustDomain: "workspace",
  scope: { level: "workspace", id: scopeId("workspace") },
  securityCritical,
});

const request = (
  securityContext: SecurityContext = context(),
  requestedIsolation: PlacementRequest["requestedIsolation"] = "process",
): PlacementRequest => ({
  manifest: makeManifest(),
  schemaMinimum: "process",
  requestedIsolation,
  trustedComputingBase: false,
  observesClassification: "internal",
  securityContext,
  configDigest: digest("config"),
  limits: { memoryMb: 64, cpuQuota: 2, maxTokens: 100 },
});

describe("G4 isolation floors and placement", () => {
  it("refuses schema, non-TCB, and confidential isolation downgrades", () => {
    expect(() => assertIsolation(request(context(), "in-process"))).toThrow(
      IsolationFloorError,
    );
    expect(() =>
      assertIsolation({
        ...request(),
        schemaMinimum: "declarative",
        observesClassification: "confidential",
        requestedIsolation: "in-process",
      })
    ).toThrow(IsolationFloorError);
  });

  it("cold-spawns at the same isolation after pool exhaustion", async () => {
    const placements = new PlacementManager(new MemoryRecordAppender());
    placements.addWarmSandbox("process");
    placements.registerCold("first", request());
    placements.registerCold("second", request());
    const first = await placements.activate("first");
    const second = await placements.activate("second");
    expect(first.sandbox.coldSpawned).toBe(false);
    expect(second.sandbox.coldSpawned).toBe(true);
    expect(second.sandbox.isolation).toBe("process");
    expect(second.cgroups).toEqual({
      cpuMax: 2,
      memoryMaxBytes: 67_108_864,
    });
    expect(second.cgroups).not.toHaveProperty("maxTokens");
  });

  it("audits explicit cohabitation and relocates divergent occupants", async () => {
    const records = new MemoryRecordAppender();
    const placements = new PlacementManager(records);
    placements.registerCold("host", request());
    const host = await placements.activate("host");
    placements.registerCold("guest", {
      ...request(),
      limits: { memoryMb: 32 },
    });
    const shared = await placements.cohabit("guest", "host");
    expect(shared.sandbox.id).toBe(host.sandbox.id);
    expect(shared.cgroups.memoryMaxBytes).toBe(33_554_432);
    expect(
      records.list().some((record) =>
        record.type === "placement.cohabited"
        && record.durability === "effect-gating"
      ),
    ).toBe(true);

    const changed = {
      ...context(),
      effectiveCeilingDigest: digest("changed-ceiling"),
    };
    const relocated = await placements.ensureCurrent("guest", changed);
    expect(relocated.sandbox.id).not.toBe(shared.sandbox.id);
    expect(records.list().at(-1)?.type).toBe("placement.relocated");
  });

  it("never cohabits across a security-critical boundary", async () => {
    const placements = new PlacementManager(new MemoryRecordAppender());
    placements.registerCold("critical", request(context(true)));
    await placements.activate("critical");
    placements.registerCold("ordinary", request());
    await expect(placements.cohabit("ordinary", "critical")).rejects.toThrow(
      "cannot cohabit",
    );
  });
});
