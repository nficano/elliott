import { describe, expect, it } from "bun:test";
import { NoEligibleRouteError } from "../../src/core/errors";
import { RouteTableStore } from "../../src/model/routetable";
import {
  makeCatalogEntry,
  makeProviderState,
  makeRouteContext,
} from "../helpers";

describe("RouteTableStore cache maintenance", () => {
  it("orders equal-priority routes by cost and invalidates providers", () => {
    const cheap = makeProviderState("cheap", [
      makeCatalogEntry("model", "local", ["text"]),
    ]);
    const pricey = makeProviderState("pricey", [
      makeCatalogEntry("model", "local", ["text"]),
    ]);
    const context = {
      ...makeRouteContext(cheap),
      providers: [cheap, pricey],
      profiles: {
        profiles: {
          fast: {
            routes: [
              {
                provider: "pricey",
                model: "model",
                priority: 1,
                costMetric: 5,
              },
              { provider: "cheap", model: "model", priority: 1, costMetric: 1 },
            ],
            digest: cheap.catalogDigest,
          },
          balanced: {
            routes: [
              {
                provider: "pricey",
                model: "model",
                priority: 1,
                costMetric: 5,
              },
              { provider: "cheap", model: "model", priority: 1, costMetric: 1 },
            ],
            digest: cheap.catalogDigest,
          },
          deep: {
            routes: [
              {
                provider: "pricey",
                model: "model",
                priority: 1,
                costMetric: 5,
              },
              { provider: "cheap", model: "model", priority: 1, costMetric: 1 },
            ],
            digest: cheap.catalogDigest,
          },
        },
      },
      inputDigests: [
        cheap.catalogDigest,
        pricey.catalogDigest,
        cheap.residency.topologyDigest,
        pricey.residency.topologyDigest,
      ],
    };
    const store = new RouteTableStore();
    const key = {
      profile: "fast" as const,
      effectiveClassification: "internal" as const,
      requiredCapabilities: ["text"] as const,
    };
    const table = store.resolve(key, context);
    expect(table.candidates.map((route) => route.provider)).toEqual([
      "cheap",
      "pricey",
    ]);
    store.invalidateProvider("cheap");
    expect(store.resolve(key, context).candidates[0]?.provider).toBe("cheap");
    store.clear();
    expect(
      store.resolve(key, context).candidates.map((route) => route.provider),
    )
      .toEqual(table.candidates.map((route) => route.provider));
  });

  it("throws when no route survives filtering", () => {
    const store = new RouteTableStore();
    expect(() =>
      store.resolve({
        profile: "fast",
        effectiveClassification: "internal",
        requiredCapabilities: ["vision"],
      }, makeRouteContext())
    ).toThrow(NoEligibleRouteError);
  });
});
