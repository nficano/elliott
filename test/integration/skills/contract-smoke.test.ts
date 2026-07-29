import { describe, expect, it } from "bun:test";
import { loadBundledPackages } from "../../../src/catalog/bundled";
import {
  collectFacilities,
  collectGateways,
  collectRoutes,
  collectServices,
  collectTools,
  loadSkillRegistrations,
} from "../../../src/runtime/skills/loader";
import { makeSmokeContext, repoRoot } from "./fixtures";

// Tier-0 registration & contract smoke. Loads every implemented skill through
// the SAME path the runtime uses (loadBundledPackages -> loadSkillRegistrations)
// under a fully-populated fixture, and asserts the wiring is well-formed. The
// counts below are a deliberate snapshot: adding or removing a tool/gateway/
// route/service is expected to update this test, which surfaces the change in
// review rather than letting it drift silently. See
// docs/skill-e2e-smoke-strategy.md.

const EXPECTED = {
  tools: 41,
  gateways: 4,
  // 38 static routes + the facility-driven three: the /map alias, the
  // provisioner's /w/<slug> verification route for slack-interactivity, and
  // gateway-slack's /v1/ingress/<slug> consumer route.
  routes: 41,
  services: 6,
  facilities: 3,
} as const;

describe("skill contract smoke (Tier 0)", () => {
  it("registers every implemented skill with no register-time failures", async () => {
    const { context, reported } = await makeSmokeContext();
    const packages = await loadBundledPackages(repoRoot);
    const implemented = packages.filter((p) => p.entrypoint !== undefined);
    const skills = await loadSkillRegistrations(implemented, context);

    // A throw in register() is swallowed by report() in production — here it is
    // a hard failure.
    expect(reported).toEqual([]);
    expect(skills.length).toBe(implemented.length);
  });

  it("exposes a well-formed, drift-guarded binding surface", async () => {
    const { context } = await makeSmokeContext();
    const packages = await loadBundledPackages(repoRoot);
    const implemented = packages.filter((p) => p.entrypoint !== undefined);
    const skills = await loadSkillRegistrations(implemented, context);

    // collectTools throws on duplicate tool names — exercising it is the check.
    const tools = collectTools(skills);
    const gateways = collectGateways(skills);
    const routes = collectRoutes(skills);
    const services = collectServices(skills);
    const facilities = collectFacilities(skills);

    expect(tools.length).toBe(EXPECTED.tools);
    expect(gateways.length).toBe(EXPECTED.gateways);
    expect(routes.length).toBe(EXPECTED.routes);
    expect(services.length).toBe(EXPECTED.services);
    expect(facilities.length).toBe(EXPECTED.facilities);

    // Every facility must present a well-formed MCP-like card: stable id,
    // integer contract version, and object schemas for request and grant.
    for (const facility of facilities) {
      const descriptor = facility.describe();
      expect(descriptor.id).toBe(facility.id);
      expect(descriptor.version).toBe(facility.version);
      expect(Number.isSafeInteger(descriptor.version)).toBe(true);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.requestSchema["type"]).toBe("object");
      expect(descriptor.grantSchema["type"]).toBe("object");
    }
    expect(new Set(facilities.map((f) => f.id)).size).toBe(facilities.length);

    // Every tool must present an object JSON-Schema the model can call.
    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(typeof schema).toBe("object");
      expect(schema["type"]).toBe("object");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }

    // Routes are matched by exact method+path (first-wins) — collisions would
    // silently shadow a route, so they must be unique.
    const routeKeys = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(routeKeys).size).toBe(routeKeys.length);

    // Services must satisfy the start/stop lifecycle and a numeric health map.
    for (const service of services) {
      expect(typeof service.name).toBe("string");
      expect(typeof service.start).toBe("function");
      expect(typeof service.stop).toBe("function");
      const health = service.health?.() ?? {};
      for (const value of Object.values(health)) {
        expect(typeof value).toBe("number");
      }
    }

    // Gateways must satisfy the status/start/stop lifecycle.
    for (const gateway of gateways) {
      expect(typeof gateway.name).toBe("string");
      expect(typeof gateway.status()).toBe("string");
      expect(typeof gateway.start).toBe("function");
      expect(typeof gateway.stop).toBe("function");
    }
  });
});
