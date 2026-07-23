import { describe, expect, it } from "bun:test";
import { epoch } from "../../src/core/brands";
import { liveRouteFilter, RouteTableStore } from "../../src/model/routetable";
import type { RouteTableKey } from "../../src/model/routing/types";
import type { ModelCapability } from "../../src/model/types";
import {
  makeCatalogEntry,
  makeProviderState,
  makeResidencyGrant,
  makeRouteContext,
} from "../helpers";

describe("G18 route-table equivalence", () => {
  it("matches the live filter across fuzzed health and capability states", () => {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const healthy = iteration % 3 !== 0;
      const capabilities: readonly ModelCapability[] = iteration % 5 === 0
        ? ["text"]
        : [
          "text",
          "vision",
        ];
      const provider = makeProviderState(
        "provider",
        [makeCatalogEntry("model", "local", capabilities)],
        makeResidencyGrant("provider"),
        healthy,
      );
      const context = makeRouteContext(provider);
      const key: RouteTableKey = {
        profile: "fast",
        effectiveClassification: "internal",
        requiredCapabilities: ["vision"],
      };
      const [live] = liveRouteFilter(key, context);
      if (live.length === 0) {
        expect(() => new RouteTableStore().resolve(key, context)).toThrow();
      } else {
        const cached = new RouteTableStore().resolve(key, context);
        expect(cached.candidates.map((route) => route.provider)).toEqual(
          live.map((route) => route.provider),
        );
      }
    }
  });

  it("rebuilds synchronously when an epoch stamp changes", () => {
    const store = new RouteTableStore();
    const context = makeRouteContext();
    const key: RouteTableKey = {
      profile: "fast",
      effectiveClassification: "internal",
      requiredCapabilities: ["text"],
    };
    const first = store.resolve(key, context);
    const second = store.resolve(key, {
      ...context,
      epochVector: { ...context.epochVector, session: epoch(1) },
    });
    expect(second.version).not.toBe(first.version);
  });
});
