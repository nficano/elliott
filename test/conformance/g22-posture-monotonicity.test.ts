import { describe, expect, it } from "bun:test";
import {
  PostureController,
  postureSpec,
} from "../../src/config/postures/index";
import { scopeId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { RouteTableStore } from "../../src/model/routetable";
import type { RouteTableKey } from "../../src/model/routing/types";
import {
  makeProviderState,
  makeResidencyGrant,
  makeRouteContext,
} from "../helpers";

describe("G22 posture monotonicity bookkeeping", () => {
  it("preserves historical stamps across an injective posture migration", async () => {
    const controller = new PostureController("standard");
    const stamp = controller.stamp("restricted");
    const records = new MemoryRecordAppender();
    await records.append({
      type: "memory.write",
      scope: { level: "workspace", id: scopeId("workspace") },
      durability: "effect-gating",
      classification: stamp.classification,
      payload: { writtenUnder: stamp.writtenUnder },
    });
    controller.activate({
      from: "standard",
      to: "regulated",
      mapping: { internal: "internal" },
    });
    expect(controller.enforceStamp(stamp)).toBe("internal");
    expect(records.list()[0]?.classification).toBe("internal");
    expect(records.list()[0]?.payload.writtenUnder).toBe("standard");
    expect(() =>
      new PostureController("hardened").activate({
        from: "hardened",
        to: "regulated",
        mapping: { public: "internal", internal: "internal" },
      })
    ).toThrow("injective");
  });

  it("keeps standard bookkeeping while disabling sanitizer and residency pruning", () => {
    const standard = postureSpec("standard");
    expect(standard.sanitizerEnabled).toBe(false);
    expect(standard.trustedLocalEvaluatorRequired).toBe(false);
    expect(standard.residencyFiltering).toBe(false);
    const provider = makeProviderState(
      "provider",
      undefined,
      makeResidencyGrant("provider", "none", "public"),
    );
    const key: RouteTableKey = {
      profile: "fast",
      effectiveClassification: "restricted",
      requiredCapabilities: ["text"],
    };
    const table = new RouteTableStore().resolve(
      key,
      makeRouteContext(provider, "standard"),
    );
    expect(table.candidates).toHaveLength(1);
    expect(table.trace.map((step) => step.step)).toContain("residency");
    expect(() =>
      new RouteTableStore().resolve(
        key,
        makeRouteContext(provider, "regulated"),
      )
    ).toThrow();
  });
});
