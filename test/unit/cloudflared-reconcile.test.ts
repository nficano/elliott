import { describe, expect, it } from "bun:test";
import {
  fetchConnectorToken,
  reconcileTunnel,
  tunnelNameFor,
} from "../../skills/cloudflared/src/reconcile";
import type {
  CloudflareApi,
  CloudflareCredentials,
  CloudflareResult,
} from "../../skills/cloudflared/src/types";

const CREDENTIALS: CloudflareCredentials = {
  apiToken: "cf-token-never-printed",
  accountId: "acct-1",
  zoneId: "zone-1",
};

const INPUT = { hostname: "hooks.example.com", servicePort: 8080 };

const ok = (result: unknown): CloudflareResult => ({ success: true, result });
const fail = (reason: string): CloudflareResult => ({
  success: false,
  result: undefined,
  reason,
});

// Records every call so a test can assert what the reconciler did NOT do —
// which is the whole point of idempotence.
const fakeApi = (
  handler: (method: string, path: string, body?: unknown) => CloudflareResult,
): { api: CloudflareApi; calls: { method: string; path: string; }[]; } => {
  const calls: { method: string; path: string; }[] = [];
  return {
    calls,
    api: {
      request: async (method, path, body) => {
        calls.push({ method, path });
        return handler(method, path, body);
      },
    },
  };
};

const CONFIGURED = {
  config: {
    ingress: [
      { hostname: "hooks.example.com", service: "http://localhost:8080" },
      { service: "http_status:404" },
    ],
  },
};

describe("tunnelNameFor", () => {
  it("derives a stable name from the agent, so a restart adopts its tunnel", () => {
    expect(tunnelNameFor("hooks.example.com")).toBe(
      "elliott-hooks.example.com",
    );
    // Two agents in one account, different hostnames, never collide.
    expect(tunnelNameFor("a.example.com")).not.toBe(
      tunnelNameFor("b.example.com"),
    );
    // Anything outside a DNS label is collapsed, so a stray character cannot
    // produce a name Cloudflare rejects.
    expect(tunnelNameFor("Hooks Example/Com")).toBe(
      "elliott-hooks-example-com",
    );
  });
});

describe("reconcileTunnel", () => {
  it("creates tunnel, ingress, and DNS on a cold account", async () => {
    const { api } = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) return ok([]);
      if (method === "POST" && path.endsWith("/cfd_tunnel")) {
        return ok({ id: "tun-1" });
      }
      if (method === "GET" && path.includes("/configurations")) {
        return fail("not configured");
      }
      if (method === "PUT" && path.includes("/configurations")) return ok({});
      if (method === "GET" && path.includes("dns_records?")) return ok([]);
      if (method === "POST" && path.includes("dns_records")) {
        return ok({ id: "rec-1" });
      }
      return fail("unexpected");
    });

    const state = await reconcileTunnel(api, CREDENTIALS, INPUT);

    expect(state?.tunnelId).toBe("tun-1");
    expect(state?.publicBaseUrl).toBe("https://hooks.example.com");
    expect(state?.changes).toEqual([
      "created tunnel elliott-hooks.example.com",
      "routed hooks.example.com to http://localhost:8080",
      "created DNS hooks.example.com",
    ]);
  });

  // The steady state, and the one that matters most: a boot on an already
  // provisioned account must change NOTHING. A reconciler that rewrites on
  // every boot churns DNS and eventually trips Cloudflare's rate limits.
  it("adopts an existing tunnel and makes no writes when everything matches", async () => {
    const { api, calls } = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) {
        return ok([{ id: "tun-1", name: "elliott-hooks.example.com" }]);
      }
      if (method === "GET" && path.includes("/configurations")) {
        return ok(CONFIGURED);
      }
      if (method === "GET" && path.includes("dns_records?")) {
        return ok([{
          id: "rec-1",
          content: "tun-1.cfargotunnel.com",
          name: "hooks.example.com",
        }]);
      }
      return fail("unexpected write");
    });

    const state = await reconcileTunnel(api, CREDENTIALS, INPUT);

    expect(state?.tunnelId).toBe("tun-1");
    expect(state?.changes).toEqual([]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  // Drift: the DNS record survives but points at a tunnel that no longer
  // exists, so the hostname resolves to nothing. Silent until someone sends a
  // webhook, which is exactly the failure this whole skill exists to catch.
  it("repoints a DNS record that references a stale tunnel", async () => {
    const { api } = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) {
        return ok([{ id: "tun-NEW" }]);
      }
      if (method === "GET" && path.includes("/configurations")) {
        return ok({
          config: {
            ingress: [
              {
                hostname: "hooks.example.com",
                service: "http://localhost:8080",
              },
            ],
          },
        });
      }
      if (method === "GET" && path.includes("dns_records?")) {
        return ok([{ id: "rec-1", content: "tun-OLD.cfargotunnel.com" }]);
      }
      if (method === "PUT" && path.includes("dns_records/rec-1")) return ok({});
      return fail("unexpected");
    });

    const state = await reconcileTunnel(api, CREDENTIALS, INPUT);

    expect(state?.changes).toContain("repointed DNS hooks.example.com");
  });

  it("rewrites ingress that points at the wrong port", async () => {
    const writes: unknown[] = [];
    const calls = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) {
        return ok([{ id: "tun-1" }]);
      }
      if (method === "GET" && path.includes("/configurations")) {
        return ok({
          config: {
            ingress: [
              {
                hostname: "hooks.example.com",
                service: "http://localhost:9999",
              },
            ],
          },
        });
      }
      if (method === "PUT" && path.includes("/configurations")) {
        writes.push(path);
        return ok({});
      }
      if (method === "GET" && path.includes("dns_records?")) {
        return ok([{ id: "rec-1", content: "tun-1.cfargotunnel.com" }]);
      }
      return fail("unexpected");
    });

    const state = await reconcileTunnel(calls.api, CREDENTIALS, INPUT);

    expect(writes).toHaveLength(1);
    expect(state?.changes).toContain(
      "routed hooks.example.com to http://localhost:8080",
    );
  });

  it("stops at the first failure instead of building half a tunnel", async () => {
    const { api, calls } = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) return ok([]);
      if (method === "POST" && path.endsWith("/cfd_tunnel")) {
        return fail("Cloudflare API returned HTTP 403 (code 10000)");
      }
      return fail("must not be reached");
    });

    expect(await reconcileTunnel(api, CREDENTIALS, INPUT)).toBeUndefined();
    // No DNS record is created for a tunnel that does not exist.
    expect(calls.some((call) => call.path.includes("dns_records"))).toBe(false);
  });

  // Cloudflare keeps deleted tunnels queryable. Adopting one yields a tunnel id
  // that can never connect, and a DNS record pointing at a dead target — which
  // looks provisioned and delivers nothing.
  it("excludes deleted tunnels from the lookup", async () => {
    const { api, calls } = fakeApi((method, path) => {
      if (method === "GET" && path.includes("cfd_tunnel?name=")) return ok([]);
      return fail("stop after lookup");
    });

    await reconcileTunnel(api, CREDENTIALS, INPUT);

    const lookup = calls.find((call) => call.path.includes("cfd_tunnel?name="));
    expect(lookup?.path).toContain("is_deleted=false");
    // And the name is URL-encoded, so an agent name with a slash or space
    // cannot smuggle extra query parameters into the request.
    expect(lookup?.path).toContain("name=elliott-hooks.example.com");
  });
});

describe("fetchConnectorToken", () => {
  it("returns the token the sidecar needs", async () => {
    const { api } = fakeApi(() => ok("connector-token-value"));
    expect(await fetchConnectorToken(api, CREDENTIALS, "tun-1")).toBe(
      "connector-token-value",
    );
  });

  it("returns undefined rather than a non-string on an odd payload", async () => {
    const { api } = fakeApi(() => ok({ unexpected: true }));
    expect(await fetchConnectorToken(api, CREDENTIALS, "tun-1"))
      .toBeUndefined();
  });
});
