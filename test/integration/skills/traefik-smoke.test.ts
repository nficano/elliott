import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for traefik. Covers the route lifecycle (set/list/
// remove), the dynamic-config route Traefik itself polls, and the proxy.route
// facility it provides. See docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("traefik skill logic (Tier 1)", () => {
  it("stays dormant without traefik settings", async () => {
    const { context } = await makeSmokeContext({ traefik: undefined });
    const registration = await loadOneSkill("traefik", context);
    expect(registration.tools ?? []).toHaveLength(0);
    expect(registration.facilities ?? []).toHaveLength(0);
  });

  it("sets, lists, and removes a route, publishing it to the dynamic config route", async () => {
    stubFetch([{ match: "127.0.0.1", body: JSON.stringify([]) }]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("traefik", context);
    const set = toolByName(registration, "traefik_route_set");
    const list = toolByName(registration, "traefik_route_list");
    const remove = toolByName(registration, "traefik_route_remove");

    await set.execute({
      name: "home",
      hostname: "home.example.com",
      service_url: "http://192.0.2.10:8080",
    });
    const listed = JSON.parse(await list.execute({}));
    expect(listed.routes.home).toEqual({
      hostname: "home.example.com",
      serviceUrl: "http://192.0.2.10:8080/",
    });

    const route = registration.routes?.[0];
    if (route === undefined) throw new Error("dynamic config route missing");
    const response = await route.handle(
      new Request("http://localhost/v1/traefik/dynamic"),
      makeGatewayEvents().events,
    );
    const config = await response.json();
    expect(config.http.routers["elliott-home"].rule).toBe(
      "Host(`home.example.com`)",
    );

    await remove.execute({ name: "home" });
    const afterRemove = JSON.parse(await list.execute({}));
    expect(afterRemove.routes).toEqual({});
  });

  it("provides the proxy.route facility and mints a grant", async () => {
    stubFetch([]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("traefik", context);
    const facility = registration.facilities?.[0];
    if (facility === undefined) throw new Error("proxy.route facility missing");
    expect(facility.id).toBe("proxy.route");
    const grant = await facility.acquire({
      consumer: "gateway-slack",
      name: "interactivity",
      config: {
        hostname: "hooks.example.com",
        serviceUrl: "http://127.0.0.1:8080",
      },
    });
    expect(grant.values["hostname"]).toBe("hooks.example.com");
    expect(grant.values["url"]).toBe("https://hooks.example.com");
  });
});
