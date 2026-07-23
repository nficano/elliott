import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { RouteTableStore } from "../../src/model/routetable";
import type { RouteTableKey } from "../../src/model/routing/types";
import { ResidencyRegistry } from "../../src/security/residency/residency";
import {
  makeCatalogEntry,
  makeProviderState,
  makeResidencyGrant,
  makeRouteContext,
} from "../helpers";

describe("G2 residency consistency", () => {
  it("rejects a local catalog claim backed by external egress", async () => {
    const grant = makeResidencyGrant("lying", "declared", "internal");
    const registry = new ResidencyRegistry(
      new MemoryRecordAppender(),
      async () => undefined,
    );
    await expect(registry.register({
      grant,
      catalog: [makeCatalogEntry("model", "local")],
      declaredTopologyDigest: grant.topologyDigest,
      probe: {
        tcpReachable: false,
        udpReachable: false,
        dnsReachable: false,
        observedTopologyDigest: grant.topologyDigest,
      },
    })).rejects.toThrow("claims local");
  });

  it("filters dispatch from the kernel grant rather than catalog locality", () => {
    const catalog = makeCatalogEntry("model", "local", ["text"]);
    const deniedProvider = makeProviderState(
      "local",
      [catalog],
      makeResidencyGrant("local", "none", "internal"),
    );
    const allowedProvider = makeProviderState(
      "local",
      [catalog],
      makeResidencyGrant("local", "none", "restricted"),
    );
    const key: RouteTableKey = {
      profile: "fast",
      effectiveClassification: "confidential",
      requiredCapabilities: ["text"],
    };
    expect(() =>
      new RouteTableStore().resolve(key, makeRouteContext(deniedProvider))
    ).toThrow();
    expect(
      new RouteTableStore().resolve(key, makeRouteContext(allowedProvider))
        .candidates,
    ).toHaveLength(1);
  });

  it("fails local registration when any egress canary channel succeeds", async () => {
    const grant = makeResidencyGrant("leaky");
    const registry = new ResidencyRegistry(
      new MemoryRecordAppender(),
      async () => undefined,
    );
    await expect(registry.register({
      grant,
      catalog: [makeCatalogEntry()],
      declaredTopologyDigest: grant.topologyDigest,
      probe: {
        tcpReachable: true,
        udpReachable: false,
        dnsReachable: false,
        observedTopologyDigest: digest("topology:leaky"),
      },
    })).rejects.toThrow("egress canary");
  });
});
