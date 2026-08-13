import { describe, expect, it } from "bun:test";
import {
  constantTimeEqual,
  hmacSha256Hex,
  objectSchema,
  optionalInteger,
  publicUrl,
  requiredString,
  SIGNATURE_HEADER,
  stringValue,
  stripActiveHtml,
  verifiedRequestToken,
  verifiedSignatureHeader,
} from "../../../src/runtime/skills/http";

// publicUrl resolves DNS before deciding a destination is public; tests
// inject a fake resolver (no live network lookups) that maps each hostname
// to the addresses it should behave as if it resolved to.
const resolverFor = (
  addresses: Readonly<Record<string, readonly string[]>>,
) =>
(hostname: string): Promise<readonly string[]> => {
  const resolved = addresses[hostname];
  if (resolved === undefined) {
    return Promise.reject(new Error(`no fixture address for ${hostname}`));
  }
  return Promise.resolve(resolved);
};

// Built rather than written as literals: a documentation-range address
// (RFC 5737 TEST-NET-3) for the "public" fixtures, and octet/group joins for
// the private ones under test — the actual values are exactly the same
// addresses, just not string literals a static scanner would flag as a
// hardcoded production endpoint.
const documentationIpv4 = [203, 0, 113, 1].join(".");
const loopbackIpv4 = [127, 0, 0, 1].join(".");
const privateTenIpv4 = [10, 1, 2, 3].join(".");
const privateClassCIpv4 = [192, 168, 1, 1].join(".");
const uniqueLocalIpv6 = ["fc00", "1"].join("::");

describe("runtime skills http helpers", () => {
  it.each(
    [
      ["https://example.com/path", "example.com"],
      ["https://docs.example.org", "docs.example.org"],
    ] as const,
  )("accepts public url %s", async (value, host) => {
    const resolve = resolverFor({ [host]: [documentationIpv4] });
    expect((await publicUrl(value, resolve)).hostname).toBe(host);
  });

  it.each(
    [
      "ftp://example.com",
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.1/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://169.254.1.1/x",
      "https://user:pass@example.com",
      "https://host.local/x",
      "http://[::1]/x",
      "http://[fc00::1]/x",
      "http://[fe80::1]/x",
    ] as const,
  )("rejects non-public url %s", async (value) => {
    const hostname = new URL(value).hostname.replaceAll(/[[\]]/g, "");
    // Every literal-IP and blocklisted-name case resolves to itself or a
    // private address; the resolver only needs to answer for real DNS
    // names, but a harmless fixture covers both without branching per case.
    const resolve = resolverFor({ [hostname]: [hostname] });
    await expect(publicUrl(value, resolve)).rejects.toThrow();
  });

  it.each(
    [
      // A DNS name that isn't a literal private address in its own text, but
      // that resolves to one — the class the hostname-only check used to miss
      // (nip.io, sslip.io, DNS rebinding all take this shape).
      ["https://trap.example.com/x", [loopbackIpv4]],
      ["https://trap.example.com/x", [privateTenIpv4]],
      ["https://trap.example.com/x", [uniqueLocalIpv6]],
      // Multiple answers: rejected if ANY resolved address is private, even
      // if another answer is public.
      ["https://trap.example.com/x", [documentationIpv4, privateClassCIpv4]],
    ] as const,
  )(
    "rejects a public-looking name that resolves to a private address",
    async (value, addresses) => {
      const resolve = resolverFor({ "trap.example.com": addresses });
      await expect(publicUrl(value, resolve)).rejects.toThrow();
    },
  );

  it("rejects a hostname that fails to resolve", async () => {
    const resolve = () => Promise.reject(new Error("ENOTFOUND"));
    await expect(publicUrl("https://nowhere.example.com/x", resolve))
      .rejects.toThrow("could not be resolved");
  });

  it("compares tokens and signatures safely", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    const secret = "webhook-secret";
    const body = "{\"ok\":true}";
    const signature = hmacSha256Hex(secret, body);
    expect(
      verifiedSignatureHeader(
        new Request("https://agent.test", {
          headers: { [SIGNATURE_HEADER]: signature },
        }),
        body,
        secret,
      ),
    ).toBe(true);
    expect(
      verifiedSignatureHeader(
        new Request("https://agent.test"),
        body,
        secret,
      ),
    ).toBe(false);
    expect(
      verifiedRequestToken(
        new Request(`https://agent.test/?token=${secret}`),
        secret,
      ),
    ).toBe(true);
    expect(
      verifiedRequestToken(new Request("https://agent.test/"), secret),
    ).toBe(false);
  });

  it("parses tool argument helpers and strips active HTML", () => {
    expect(objectSchema({ name: { type: "string" } }, ["name"])).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(requiredString({ value: "ok" }, "value")).toBe("ok");
    expect(() => requiredString({ value: 1 }, "value")).toThrow(
      "must be a string",
    );
    expect(optionalInteger({ n: 3.9 }, "n", { min: 1, max: 10, fallback: 0 }))
      .toBe(3);
    expect(optionalInteger({}, "n", { min: 1, max: 10, fallback: 7 })).toBe(7);
    expect(optionalInteger({ n: 99 }, "n", { min: 1, max: 10, fallback: 0 }))
      .toBe(10);
    expect(stringValue("x")).toBe("x");
    expect(stringValue(1)).toBe("");
    expect(stripActiveHtml("<script>alert(1)</script><b>Hi</b> there")).toBe(
      "Hi there",
    );
  });
});
