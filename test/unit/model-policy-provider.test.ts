import { describe, expect, it } from "bun:test";
import { scopeId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import {
  ModelUsePolicyEngine,
  narrowProfileCeiling,
} from "../../src/model/profile";
import { ProviderStateRegistry } from "../../src/model/provider";
import type { ModelProviderProtocol } from "../../src/model/types";
import {
  makeCatalogEntry,
  makeProviderState,
  makeResidencyGrant,
} from "../helpers";

describe("M4 provider state and use policy", () => {
  it("fails lapsed health closed without provider calls during resolution", async () => {
    const records = new MemoryRecordAppender();
    const invalidated: string[] = [];
    let healthCalls = 0;
    const base = makeProviderState().protocol;
    const protocol: ModelProviderProtocol = {
      catalog: () => base.catalog(),
      generate: (request) => base.generate(request),
      embed: (request) => base.embed(request),
      async health() {
        healthCalls += 1;
        return { healthy: true };
      },
    };
    const registry = new ProviderStateRegistry(
      records,
      async (provider) => {
        invalidated.push(`catalog:${provider}`);
      },
      async (provider) => {
        invalidated.push(`health:${provider}`);
      },
    );
    registry.register({
      id: "provider",
      protocol,
      residency: makeResidencyGrant("provider"),
      catalog: [makeCatalogEntry()],
      health: { healthy: true },
      reportedAtMs: 0,
      cadenceMs: 100,
    });
    expect(registry.get("provider")?.health.healthy).toBe(true);
    expect(healthCalls).toBe(0);
    await registry.markLapsed(101);
    expect(registry.get("provider")?.health.healthy).toBe(false);
    expect(invalidated).toEqual(["health:provider"]);
    expect(healthCalls).toBe(0);
  });

  it("revalidates catalog changes and invalidates only that provider", async () => {
    const invalidated: string[] = [];
    const registry = new ProviderStateRegistry(
      new MemoryRecordAppender(),
      async (provider) => {
        invalidated.push(provider);
      },
      async () => undefined,
    );
    const state = makeProviderState();
    registry.register({
      id: state.id,
      protocol: state.protocol,
      residency: state.residency,
      catalog: state.catalog,
      health: state.health,
      reportedAtMs: 0,
      cadenceMs: 100,
    });
    await registry.updateCatalog(state.id, [makeCatalogEntry("new-model")]);
    expect(registry.get(state.id)?.catalog[0]?.modelId).toBe("new-model");
    expect(invalidated).toEqual([state.id]);
  });

  it("refuses ceiling escalation and records an authorized one", async () => {
    const records = new MemoryRecordAppender();
    const engine = new ModelUsePolicyEngine({
      defaultProfile: "fast",
      uses: { planning: "balanced" },
      escalationChains: { fast: ["balanced", "deep"] },
    }, records);
    expect(engine.activityProfile("planning")).toBe("balanced");
    expect(engine.activityProfile("unknown")).toBe("fast");
    expect(
      await engine.escalate({
        activity: "planning",
        from: "fast",
        to: "deep",
        ceiling: "balanced",
        hasDeepGrant: true,
        scope: { level: "agent", id: scopeId("agent") },
      }),
    ).toEqual({ profile: "fast", escalated: false, reason: "ceiling" });
    expect(records.list()).toHaveLength(0);
    expect(
      (await engine.escalate({
        activity: "planning",
        from: "fast",
        to: "balanced",
        ceiling: "balanced",
        hasDeepGrant: false,
        scope: { level: "agent", id: scopeId("agent") },
      })).escalated,
    ).toBe(true);
    expect(records.list()[0]?.type).toBe("model.escalation");
    expect(narrowProfileCeiling("balanced", "deep")).toBe("balanced");
  });
});
