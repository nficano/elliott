import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  loadSkills,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
} from "./fixtures";
import type { FacilityGrantRow, LoadedPublishSkills } from "./types";

// Tier-1 smoke for the local-publish chain: deep-trace (consumer) acquires
// proxy.route from traefik and chains the grant's lanAddress into a dns.local
// record on pihole — the zero-config path that puts the observability map at
// https://elliott.octet.stream/map. Pi-hole answers from a v5 cassette; the
// traefik half is pure state-file work. See docs/skill-facilities.md.

afterEach(() => {
  mock.restore();
});

const HOSTNAME = "elliott.octet.stream";
const SERVICE_URL = "http://172.16.20.21:18082/";
const LAN_ADDRESS = "192.0.2.10"; // fixture traefik.lanAddress

const publishSettings = {
  deepTrace: { publicHostname: HOSTNAME, serviceUrl: SERVICE_URL },
} as const;

// v5 Pi-hole: /api/auth serves HTML (the detection signal), records come and
// go through /admin/api.php.
const piholeCassette = () =>
  stubFetch([
    { match: "/api/auth", body: "<!doctype html><title>pi-hole</title>" },
    { match: "action=add", body: JSON.stringify({ success: true }) },
    { match: "action=delete", body: JSON.stringify({ success: true }) },
    { match: "customcname", body: JSON.stringify({ data: [] }) },
    { match: "customdns", body: JSON.stringify({ data: [] }) },
  ]);

const loadPublishSkills = async (
  existing?: Pick<LoadedPublishSkills, "context" | "reported">,
): Promise<LoadedPublishSkills> => {
  const { context, reported } = existing
    ?? await makeSmokeContext(publishSettings);
  const skills = await loadSkills(
    ["pihole", "traefik", "deep-trace"],
    context,
  );
  return { context, reported, skills };
};

describe("deep-trace local publish (Tier 1)", () => {
  it("provisions the Traefik route and the Pi-hole record in one boot", async () => {
    const stub = piholeCassette();
    const { context, reported, skills } = await loadPublishSkills();

    expect(reported).toEqual([]);
    expect(skills.size).toBe(3);

    // The reverse-proxy half: the route landed in the managed table Traefik
    // polls, keyed by consumer and grant name.
    const table = JSON.parse(
      await readFile(
        path.join(context.stateDirectory, "traefik", "routes.json"),
        "utf8",
      ),
    );
    expect(table["deep-trace-public"]).toEqual({
      hostname: HOSTNAME,
      serviceUrl: SERVICE_URL,
    });

    // The DNS half: an A record for the hostname pointing at the proxy's
    // LAN address, written through the real v5 API shape.
    const added = stub.calls.find((url) => url.includes("action=add"));
    expect(added).toBeDefined();
    expect(added).toContain(`domain=${HOSTNAME}`);
    expect(added).toContain(`ip=${LAN_ADDRESS}`);

    // Both grants persisted for reboot stability.
    const grants = JSON.parse(
      await readFile(
        path.join(context.stateDirectory, "facilities", "grants.json"),
        "utf8",
      ),
    ) as { grants: FacilityGrantRow[]; };
    const byFacility = Object.fromEntries(
      grants.grants.map((item) => [item.facilityId, item]),
    );
    expect(byFacility["proxy.route"]?.consumer).toBe("deep-trace");
    expect(byFacility["dns.local"]?.grant.values).toEqual({
      domain: HOSTNAME,
      ip: LAN_ADDRESS,
    });
  });

  it("serves the published hostname through Traefik's dynamic config", async () => {
    piholeCassette();
    const { skills } = await loadPublishSkills();
    const recorder = makeGatewayEvents();

    const dynamic = skills.get("traefik")?.routes?.find(
      (route) => route.path === "/v1/traefik/dynamic",
    );
    if (dynamic === undefined) throw new Error("traefik dynamic route missing");
    const response = await dynamic.handle(
      new Request("http://runtime/v1/traefik/dynamic"),
      recorder.events,
    );
    const config = await response.json() as {
      http: {
        routers: Record<
          string,
          { rule: string; tls: { certResolver: string; }; }
        >;
        services: Record<string, { loadBalancer: { servers: unknown[]; }; }>;
      };
    };

    const router = config.http.routers["elliott-deep-trace-public"];
    expect(router?.rule).toBe(`Host(\`${HOSTNAME}\`)`);
    expect(router?.tls.certResolver).toBe("letsencrypt");
    expect(
      config.http.services["elliott-deep-trace-public"]?.loadBalancer
        .servers,
    ).toEqual([{ url: SERVICE_URL }]);
  });

  it("redirects /map into the canonical map document", async () => {
    piholeCassette();
    const { skills } = await loadPublishSkills();
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

  it("re-boots idempotently: stored grants skip re-provisioning", async () => {
    const stub = piholeCassette();
    const first = await loadPublishSkills();
    const addsAfterFirstBoot =
      stub.calls.filter((url) => url.includes("action=add")).length;

    const second = await loadPublishSkills(first);

    expect(second.reported).toEqual([]);
    const addsAfterSecondBoot =
      stub.calls.filter((url) => url.includes("action=add")).length;
    expect(addsAfterSecondBoot).toBe(addsAfterFirstBoot);
  });

  it("keeps the map serving when a provider facility is missing", async () => {
    piholeCassette();
    const { context, reported } = await makeSmokeContext(publishSettings);
    // No traefik package loaded: proxy.route has no provider.
    const skills = await loadSkills(["pihole", "deep-trace"], context);

    const map = skills.get("deep-trace");
    expect(map?.routes?.some((route) => route.path === "/map")).toBe(true);
    expect(
      reported.some((item) =>
        item.includes("deep-trace:publish")
        && item.includes("proxy.route")
      ),
    ).toBe(true);
  });

  it("fails loudly when the proxy grant cannot chain into DNS", async () => {
    piholeCassette();
    const { context, reported } = await makeSmokeContext({
      ...publishSettings,
      traefik: {
        apiUrl: "http://127.0.0.1:1",
        certResolver: "letsencrypt",
        entryPoint: "websecure",
        // no lanAddress: the dns.local chain has nothing to point at
      },
    });
    const skills = await loadSkills(
      ["pihole", "traefik", "deep-trace"],
      context,
    );

    expect(skills.size).toBe(3);
    expect(
      reported.some((item) =>
        item.includes("deep-trace:publish")
        && item.includes("lan_address")
      ),
    ).toBe(true);
  });
});
