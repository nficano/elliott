import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for the local-network skills (pihole, traefik).
// Fetch is stubbed with a cassette so these run offline while driving each
// tool's real request-building, session handling, and parse logic — for
// pihole in both API generations (v6 FTL REST and v5 api.php). See
// docs/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

// v6: POST /api/auth answers JSON (the detection signal) and config lives at
// /api/config/dns/*.
const v6Cassette = (hosts: readonly string[], cnames: readonly string[]) =>
  [
    {
      match: "/api/auth",
      body: JSON.stringify({ session: { valid: true, sid: "sid-1" } }),
      headers: { "content-type": "application/json" },
    },
    {
      match: "cnameRecords",
      body: JSON.stringify({ config: { dns: { cnameRecords: cnames } } }),
    },
    {
      match: "dns/hosts",
      body: JSON.stringify({ config: { dns: { hosts: hosts } } }),
    },
  ] as const;

// v5: /api/auth is served as HTML by lighttpd (the detection signal) and
// records come from /admin/api.php rows.
const v5Cassette = (
  hosts: readonly (readonly [string, string])[],
  cnames: readonly (readonly [string, string])[],
) =>
  [
    { match: "/api/auth", body: "<!doctype html><title>pi-hole</title>" },
    {
      match: "action=add",
      body: JSON.stringify({ success: true, message: "" }),
    },
    { match: "customcname", body: JSON.stringify({ data: cnames }) },
    { match: "customdns", body: JSON.stringify({ data: hosts }) },
  ] as const;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("pihole skill logic (Tier 1, v6 API)", () => {
  it("authenticates then lists host and CNAME records", async () => {
    const stub = stubFetch(
      v6Cassette(["127.0.0.1 nas.lan media.lan"], ["music.lan,nas.lan"]),
    );
    const { context } = await makeSmokeContext();
    const list = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_list",
    );

    const result = JSON.parse(await list.execute({}));
    expect(result.hosts).toEqual([
      { ip: "127.0.0.1", domains: ["nas.lan", "media.lan"] },
    ]);
    expect(result.cnames).toEqual([{ alias: "music.lan", target: "nas.lan" }]);
    expect(stub.calls[0]).toContain("/api/auth"); // detection + session first
  });

  it("sets an A record via the encoded config element path", async () => {
    const stub = stubFetch(v6Cassette([], []));
    const { context } = await makeSmokeContext();
    const set = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_set",
    );

    await set.execute({ domain: "nas.lan", ip: "127.0.0.10" });
    expect(
      stub.calls.some((url) =>
        url.includes("/api/config/dns/hosts/127.0.0.10%20nas.lan")
      ),
    ).toBe(true);
  });

  it("rejects ambiguous or malformed records before any write", async () => {
    const stub = stubFetch(v6Cassette([], []));
    const { context } = await makeSmokeContext();
    const set = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_set",
    );

    await expect(set.execute({ domain: "nas.lan" })).rejects
      .toThrow(/exactly one/);
    await expect(
      set.execute({
        domain: "nas.lan",
        ip: "127.0.0.10",
        target: "other.lan",
      }),
    ).rejects.toThrow(/exactly one/);
    await expect(set.execute({ domain: "bad domain", ip: "127.0.0.10" }))
      .rejects.toThrow(/Invalid hostname/);
    expect(stub.calls).toEqual([]); // validation short-circuits before fetch
  });

  it("peels one domain out of a multi-domain host element", async () => {
    const stub = stubFetch(
      v6Cassette(["127.0.0.1 nas.lan media.lan"], ["music.lan,nas.lan"]),
    );
    const { context } = await makeSmokeContext();
    const remove = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_remove",
    );

    const result = JSON.parse(await remove.execute({ domain: "nas.lan" }));
    // The whole element is deleted, then re-added without the target domain;
    // the CNAME whose alias differs is left alone.
    expect(result.removed).toBe(1);
    expect(
      stub.calls.some((url) =>
        url.includes("dns/hosts/127.0.0.1%20nas.lan%20media.lan")
      ),
    ).toBe(true);
    expect(
      stub.calls.some((url) =>
        url.includes("dns/hosts/127.0.0.1%20media.lan")
        && !url.includes("nas.lan")
      ),
    ).toBe(true);
  });

  it("re-authenticates once when the cached session expires", async () => {
    const auth = { count: 0 };
    const hosts = { attempts: 0 };
    const impl = (input: string | URL | Request): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/auth")) {
        auth.count += 1;
        return Promise.resolve(
          Response.json({ session: { valid: true, sid: `sid-${auth.count}` } }),
        );
      }
      if (url.includes("dns/hosts")) {
        hosts.attempts += 1;
        // First config read 401s (expired sid); the retry must succeed.
        if (hosts.attempts === 1) {
          return Promise.resolve(new Response("{}", { status: 401 }));
        }
        return Promise.resolve(
          Response.json({ config: { dns: { hosts: [] } } }),
        );
      }
      return Promise.resolve(
        Response.json({ config: { dns: { cnameRecords: [] } } }),
      );
    };
    spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);

    const { context } = await makeSmokeContext();
    const list = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_list",
    );
    const result = JSON.parse(await list.execute({}));
    expect(result.hosts).toEqual([]);
    expect(auth.count).toBe(2); // detection session + one refresh, no loop
  });
});

describe("pihole skill logic (Tier 1, v5 API)", () => {
  it("falls back to api.php and parses (domain, ip) rows", async () => {
    const stub = stubFetch(
      v5Cassette([["nas.lan", "127.0.0.1"]], [["music.lan", "nas.lan"]]),
    );
    const { context } = await makeSmokeContext();
    const list = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_list",
    );

    const result = JSON.parse(await list.execute({}));
    expect(result.hosts).toEqual([{ ip: "127.0.0.1", domains: ["nas.lan"] }]);
    expect(result.cnames).toEqual([{ alias: "music.lan", target: "nas.lan" }]);
    expect(stub.calls[0]).toContain("/api/auth"); // detection probe first
  });

  it("adds records through api.php with the derived auth token", async () => {
    const stub = stubFetch(v5Cassette([], []));
    const { context } = await makeSmokeContext();
    const set = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_set",
    );

    await set.execute({ domain: "nas.lan", ip: "127.0.0.10" });
    const add = stub.calls.find((url) => url.includes("action=add"));
    expect(add).toContain("/admin/api.php");
    expect(add).toContain("customdns=");
    expect(add).toContain("ip=127.0.0.10");
    expect(add).toContain("domain=nas.lan");
    // v5 auth token is the double-SHA256 of the stored password ("x").
    expect(add).toContain(`auth=${sha256Hex(sha256Hex("x"))}`);
  });

  it("tolerates api.php's stray [] trailer after the payload", async () => {
    // Observed live on Pi-hole v5.9: api.php emits its default "[]" document
    // *after* the handler payload, e.g. `{"data":[...]}[]`.
    stubFetch([
      { match: "/api/auth", body: "<!doctype html><title>pi-hole</title>" },
      {
        match: "customcname",
        body: `${JSON.stringify({ data: [] })}[]`,
      },
      {
        match: "customdns",
        body: `${JSON.stringify({ data: [["nas.lan", "127.0.0.1"]] })}[]`,
      },
    ]);
    const { context } = await makeSmokeContext();
    const list = toolByName(
      await loadOneSkill("pihole", context),
      "pihole_dns_list",
    );

    const result = JSON.parse(await list.execute({}));
    expect(result.hosts).toEqual([{ ip: "127.0.0.1", domains: ["nas.lan"] }]);
  });
});

describe("traefik skill logic (Tier 1)", () => {
  it("publishes managed routes as Traefik dynamic configuration", async () => {
    stubFetch([]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("traefik", context);
    const set = toolByName(registration, "traefik_route_set");
    const dynamic = registration.routes?.find(
      (route) => route.path === "/v1/traefik/dynamic",
    );
    expect(dynamic).toBeDefined();

    await set.execute({
      name: "grafana",
      hostname: "grafana.octet.stream",
      service_url: "http://127.0.0.1:3000",
    });
    const response = await dynamic!.handle(
      new Request("http://localhost/v1/traefik/dynamic"),
      makeGatewayEvents().events,
    );
    const config = await response.json() as {
      http: {
        routers: Record<string, {
          rule: string;
          entryPoints: string[];
          tls: { certResolver: string; };
        }>;
        services: Record<
          string,
          { loadBalancer: { servers: { url: string; }[]; }; }
        >;
      };
    };
    const router = config.http.routers["elliott-grafana"];
    expect(router?.rule).toBe("Host(`grafana.octet.stream`)");
    expect(router?.entryPoints).toEqual(["websecure"]);
    expect(router?.tls).toEqual({ certResolver: "letsencrypt" });
    expect(
      config.http.services["elliott-grafana"]?.loadBalancer.servers,
    ).toEqual([{ url: "http://127.0.0.1:3000/" }]);
  });

  it("removes a managed route and validates inputs", async () => {
    stubFetch([]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("traefik", context);
    const set = toolByName(registration, "traefik_route_set");
    const remove = toolByName(registration, "traefik_route_remove");
    const list = toolByName(registration, "traefik_route_list");

    await set.execute({
      name: "nas",
      hostname: "nas.octet.stream",
      service_url: "http://127.0.0.1:5000",
    });
    const removed = JSON.parse(await remove.execute({ name: "nas" }));
    expect(removed.routes).toEqual({});
    await expect(remove.execute({ name: "nas" })).rejects
      .toThrow(/No managed route/);
    await expect(
      set.execute({
        name: "bad name",
        hostname: "x.lan",
        service_url: "http://127.0.0.1:1",
      }),
    ).rejects.toThrow(/Invalid route name/);
    await expect(
      set.execute({
        name: "ok",
        hostname: "x.lan",
        service_url: "ftp://127.0.0.1:1",
      }),
    ).rejects.toThrow(/HTTP or HTTPS/);

    // The Traefik API being down degrades to a note, not a failure.
    const listed = JSON.parse(await list.execute({}));
    expect(typeof listed.routers).toBe("string");
  });

  it("serves a valid empty document and persists routes across reloads", async () => {
    stubFetch([]);
    const { context } = await makeSmokeContext();
    const first = await loadOneSkill("traefik", context);
    const dynamic = first.routes?.find(
      (route) => route.path === "/v1/traefik/dynamic",
    );

    // No managed routes: must serialize to {} — Traefik's parser rejects
    // empty routers/services maps as "standalone elements".
    const empty = await (await dynamic!.handle(
      new Request("http://localhost/v1/traefik/dynamic"),
      makeGatewayEvents().events,
    )).json();
    expect(empty).toEqual({});

    await toolByName(first, "traefik_route_set").execute({
      name: "vault",
      hostname: "vault.octet.stream",
      service_url: "http://127.0.0.1:8200",
    });

    // A fresh registration (same state directory) must serve the same table —
    // this is what survives an Elliott restart in production.
    const second = await loadOneSkill("traefik", context);
    const listed = JSON.parse(
      await toolByName(second, "traefik_route_list").execute({}),
    );
    expect(listed.routes).toEqual({
      vault: {
        hostname: "vault.octet.stream",
        serviceUrl: "http://127.0.0.1:8200/",
      },
    });
  });
});
