import { afterEach, describe, expect, it, mock } from "bun:test";
import { loadSkills, makeGatewayEvents, makeSmokeContext } from "./fixtures";

// Tier-1 smoke for deep-trace's publish path in a framework that ships built-ins
// only. The proxy.route (traefik) and dns.local (pihole) providers now live in
// the nficano/skills registry, not in skills/. deep-trace stays built-in and its
// manifest still declares facility.use for both — so this asserts the documented
// degrade (docs/explanation/skills-registry.md#fatal-versus-degraded): loading
// deep-trace alone, with a
// public hostname configured, must NOT throw at register(); the observability
// map keeps serving locally and the absent facility is reported, not crashed.

afterEach(() => {
  mock.restore();
});

const HOSTNAME = "elliott.example.com";
const SERVICE_URL = "http://192.0.2.10:8080/";

const publishSettings = {
  deepTrace: { publicHostname: HOSTNAME, serviceUrl: SERVICE_URL },
} as const;

describe("deep-trace publish degradation (Tier 1)", () => {
  it("registers and serves the map when no facility provider is installed", async () => {
    const { context, reported } = await makeSmokeContext(publishSettings);
    // Only deep-trace is loaded: neither proxy.route nor dns.local has a
    // provider, exactly like a fresh built-ins-only elliott.
    const skills = await loadSkills(["deep-trace"], context);

    // register() did not throw — the skill loaded despite the absent facilities.
    expect(skills.size).toBe(1);
    const map = skills.get("deep-trace");
    expect(map).toBeDefined();

    // The observability map still serves locally.
    expect(map?.routes?.some((route) => route.path === "/map")).toBe(true);

    // The missing proxy.route facility is reported (not crashed): publish
    // absorbs the acquire-time error and records it against deep-trace:publish.
    expect(
      reported.some((item) =>
        item.includes("deep-trace:publish")
        && item.includes("proxy.route")
      ),
    ).toBe(true);
  });

  it("redirects /map into the canonical map document", async () => {
    const { context } = await makeSmokeContext(publishSettings);
    const skills = await loadSkills(["deep-trace"], context);
    const recorder = makeGatewayEvents();

    const alias = skills.get("deep-trace")?.routes?.find(
      (route) => route.path === "/map",
    );
    if (alias === undefined) throw new Error("map alias route missing");
    const response = await alias.handle(
      new Request("http://runtime/map"),
      recorder.events,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/v1/observability/map");
  });
});
