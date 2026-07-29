import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { standaloneFacilityDirectory } from "../../../src/runtime/skills/facilities";
import type { SkillContext } from "../../../src/runtime/skills/types";
import {
  loadOneSkill,
  smokeSettings,
  toolByName,
} from "../../integration/skills/fixtures";

// Tier-2 e2e for the local-network skills (see docs/skill-e2e-smoke-strategy.md).
// These hit REAL systems and are gated behind env vars so the default CI run
// skips them. They run from a LAN machine (or the deploy canary):
//
//   ELLIOTT_E2E_PIHOLE_URL=http://172.16.10.205 \
//   ELLIOTT_E2E_PIHOLE_PASSWORD=... \
//   ELLIOTT_E2E_BASE_URL=http://172.16.20.21:18082 \
//   bun test test/e2e/skills/local-network.e2e.test.ts
//
// The Pi-hole roundtrip creates and deletes a clearly-labeled probe record
// (elliott-e2e-probe.octet.stream -> 127.0.0.99) and restores the original state.

const PIHOLE_URL = Bun.env["ELLIOTT_E2E_PIHOLE_URL"];
const PIHOLE_PASSWORD = Bun.env["ELLIOTT_E2E_PIHOLE_PASSWORD"];
const ELLIOTT_URL = Bun.env["ELLIOTT_E2E_BASE_URL"];

const PROBE_DOMAIN = "elliott-e2e-probe.octet.stream";
const PROBE_IP = "127.0.0.99";

const piholeContext = async (): Promise<SkillContext> => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "elliott-e2e-"));
  return {
    settings: {
      ...smokeSettings(stateDirectory),
      pihole: { baseUrl: PIHOLE_URL ?? "", password: PIHOLE_PASSWORD ?? "" },
    },
    stateDirectory,
    facilities: standaloneFacilityDirectory(),
    packages: () => [],
    report: () => {},
    deliver: async () => {},
  };
};

describe("pihole e2e (Tier 2, gated)", () => {
  it.skipIf(PIHOLE_URL === undefined || PIHOLE_PASSWORD === undefined)(
    "round-trips a probe record against the live Pi-hole",
    async () => {
      const registration = await loadOneSkill("pihole", await piholeContext());
      const list = toolByName(registration, "pihole_dns_list");
      const set = toolByName(registration, "pihole_dns_set");
      const remove = toolByName(registration, "pihole_dns_remove");
      const domains = (snapshot: {
        hosts: { ip: string; domains: string[]; }[];
      }) => snapshot.hosts.flatMap((host) => host.domains);

      const before = JSON.parse(await list.execute({}));
      expect(domains(before)).not.toContain(PROBE_DOMAIN);
      try {
        const after = JSON.parse(
          await set.execute({ domain: PROBE_DOMAIN, ip: PROBE_IP }),
        );
        expect(domains(after)).toContain(PROBE_DOMAIN);
      } finally {
        const cleaned = JSON.parse(
          await remove.execute({ domain: PROBE_DOMAIN }),
        );
        expect(domains(cleaned)).not.toContain(PROBE_DOMAIN);
      }
    },
  );
});

describe("traefik e2e (Tier 2, gated)", () => {
  it.skipIf(ELLIOTT_URL === undefined)(
    "serves well-formed dynamic config from the deployed runtime",
    async () => {
      const response = await fetch(
        new URL("/v1/traefik/dynamic", ELLIOTT_URL),
        { signal: AbortSignal.timeout(10_000) },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("json");
      const config = await response.json() as {
        http?: { routers?: object; services?: object; };
      };
      // Traefik's HTTP provider rejects malformed documents wholesale. The
      // contract: {} when no routes are managed, otherwise http.routers and
      // http.services objects (empty maps are parser errors in Traefik).
      if (config.http === undefined) {
        expect(config).toEqual({});
      } else {
        expect(typeof config.http.routers).toBe("object");
        expect(typeof config.http.services).toBe("object");
      }
    },
  );

  it.skipIf(ELLIOTT_URL === undefined)(
    "reports the skill surface through the deployed /healthz",
    async () => {
      const response = await fetch(new URL("/healthz", ELLIOTT_URL), {
        signal: AbortSignal.timeout(10_000),
      });
      expect(response.status).toBe(200);
      const health = await response.json() as {
        ready: boolean;
        skills: number;
        tools: number;
      };
      expect(health.ready).toBe(true);
      expect(health.skills).toBeGreaterThan(0);
      expect(health.tools).toBeGreaterThan(0);
    },
  );

  it.skipIf(ELLIOTT_URL === undefined)(
    "serves the /map alias published through the facility seam",
    async () => {
      const response = await fetch(new URL("/map", ELLIOTT_URL), {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/v1/observability/map");
    },
  );
});

// The full published-hostname path (Pi-hole record -> Traefik route -> map),
// probed by hostname so it exercises LAN DNS + the proxy + the certificate.
describe("published map hostname e2e (Tier 2, gated)", () => {
  const MAP_URL = Bun.env["ELLIOTT_E2E_MAP_URL"];
  it.skipIf(MAP_URL === undefined)(
    "answers on the published hostname with the map redirect",
    async () => {
      const response = await fetch(new URL("/map", MAP_URL), {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/v1/observability/map");
    },
  );
});
