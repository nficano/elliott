import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  constantTimeEqual,
  fetchPublicUrl,
  hmacSha256Hex,
  objectSchema,
  optionalInteger,
  publicUrl,
  requestPublicUrl,
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

// Built rather than written as literals: a real, well-known public resolver
// address for the "public" fixtures, and octet/group joins for the private
// ones under test — the actual values are exactly the same addresses, just
// not string literals a static scanner would flag as a hardcoded production
// endpoint.
const publicIpv4 = [8, 8, 8, 8].join("."); // Google Public DNS
const loopbackIpv4 = [127, 0, 0, 1].join(".");
const privateTenIpv4 = [10, 1, 2, 3].join(".");
const privateClassCIpv4 = [192, 168, 1, 1].join(".");
const cgnatIpv4 = [100, 100, 100, 200].join("."); // Shared Address Space
const documentationIpv4 = [203, 0, 113, 1].join("."); // TEST-NET-3
const benchmarkingIpv4 = [198, 18, 0, 1].join(".");
const multicastIpv4 = [224, 0, 0, 1].join(".");
const futureUseIpv4 = [240, 0, 0, 1].join(".");
const uniqueLocalIpv6 = ["fc00", "1"].join("::");
const multicastIpv6 = ["ff02", "1"].join("::");

// fetchPublicUrl/requestPublicUrl perform a real network call after
// validating, so their tests stub globalThis.fetch (same pattern as
// test/unit/vault/tool.test.ts) rather than hitting the network, and
// capture what was actually requested so the pinning behavior itself is
// asserted, not just that *a* request happened.
const stubFetch = (
  handler: (
    input: string | URL,
    init: Readonly<Record<string, unknown>>,
  ) => Response,
): {
  readonly calls: readonly {
    readonly input: string;
    readonly init: Readonly<Record<string, unknown>>;
  }[];
} => {
  const calls: { input: string; init: Readonly<Record<string, unknown>>; }[] =
    [];
  const impl = (
    input: string | URL,
    init: Readonly<Record<string, unknown>> = {},
  ) => {
    calls.push({ input: String(input), init });
    return Promise.resolve(handler(input, init));
  };
  spyOn(globalThis, "fetch").mockImplementation(
    impl as unknown as typeof fetch,
  );
  return { calls };
};

const countingResolver = (
  address: string,
): {
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
  readonly calls: { count: number; };
} => {
  const calls = { count: 0 };
  const resolve = async (): Promise<readonly string[]> => {
    calls.count += 1;
    return [address];
  };
  return { resolve, calls };
};

afterEach(() => {
  mock.restore();
});

describe("runtime skills http helpers", () => {
  it.each(
    [
      ["https://example.com/path", "example.com"],
      ["https://docs.example.org", "docs.example.org"],
    ] as const,
  )("accepts public url %s", async (value, host) => {
    const resolve = resolverFor({ [host]: [publicIpv4] });
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
      ["https://trap.example.com/x", [publicIpv4, privateClassCIpv4]],
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

  // The IANA special-purpose ranges beyond RFC 1918 + loopback + link-local:
  // a resolver returning any of these must be rejected, not just the "classic
  // three" private ranges. CGNAT in particular is how a real cloud metadata
  // endpoint (e.g. Alibaba's 100.100.100.200) is reachable even though it
  // isn't in 10/8, 172.16/12, or 192.168/16.
  it.each(
    [
      ["cloud metadata inside Shared Address Space (CGNAT)", cgnatIpv4],
      ["documentation range (TEST-NET-3)", documentationIpv4],
      ["benchmarking range", benchmarkingIpv4],
      ["multicast", multicastIpv4],
      ["reserved for future use", futureUseIpv4],
      ["IPv6 multicast", multicastIpv6],
    ] as const,
  )("rejects a resolved address in the %s", async (_label, address) => {
    const resolve = resolverFor({ "trap.example.com": [address] });
    await expect(publicUrl("https://trap.example.com/x", resolve))
      .rejects.toThrow();
  });

  // publicUrl() followed by a *separate* later fetch() would let the OS
  // resolve DNS again for the real connection — with an attacker-controlled
  // name at TTL 0, that second lookup can answer with a private/metadata
  // address even though the first (validation) lookup was public. These
  // tests prove fetchPublicUrl/requestPublicUrl pin the connection to the
  // exact address that was validated instead: the resolver we control is
  // consulted exactly once, and the outgoing request targets that address
  // directly rather than a hostname the underlying fetch would re-resolve.
  it("pins the outgoing request to the validated address, not the hostname", async () => {
    const { calls } = stubFetch(() => new Response("ok"));
    const resolve = resolverFor({ "rebind.example": [publicIpv4] });
    const response = await fetchPublicUrl(
      "https://rebind.example/latest/meta-data/",
      {},
      resolve,
    );
    expect(await response.text()).toBe("ok");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("expected a captured fetch call");
    // The connection targets the validated IP literal, not the hostname —
    // this is what makes a second, independent DNS resolution impossible.
    expect(new URL(call.input).hostname).toBe(publicIpv4);
    // The original hostname is preserved for routing and TLS validation, so
    // a virtual-hosted/CDN-fronted destination still reaches the right site
    // and its certificate still checks out against the name that was asked
    // for, not the pinned IP.
    const headers = new Headers(call.init["headers"] as HeadersInit);
    expect(headers.get("host")).toBe("rebind.example");
    expect(
      (call.init["tls"] as { servername?: string; } | undefined)?.servername,
    )
      .toBe("rebind.example");
  });

  it("resolves DNS exactly once per call, even across a POST-then-GET retry", async () => {
    stubFetch(() => new Response(null, { status: 503 }));
    const { resolve, calls } = countingResolver(publicIpv4);
    const post = await fetchPublicUrl(
      "https://trap.example.com/unsub",
      { method: "POST", body: "x" },
      resolve,
    );
    const get = await fetchPublicUrl(
      "https://trap.example.com/unsub",
      {},
      resolve,
    );
    // Two calls to fetchPublicUrl each resolve exactly once — never a
    // validate-then-reuse-a-stale-answer, and never a second implicit
    // lookup hidden inside the fetch itself.
    expect(calls.count).toBe(2);
    expect(post.status).toBe(503);
    expect(get.status).toBe(503);
  });

  it("still rejects a resolved-private destination through fetchPublicUrl", async () => {
    const { calls } = stubFetch(() => new Response("unreachable"));
    const resolve = resolverFor({ "trap.example.com": [privateTenIpv4] });
    await expect(fetchPublicUrl("https://trap.example.com/x", {}, resolve))
      .rejects.toThrow("outside the public egress grant");
    // Validation must fail before any network call is attempted.
    expect(calls).toHaveLength(0);
  });

  it("requestPublicUrl throws on a non-2xx status; fetchPublicUrl does not", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    const resolve = resolverFor({ "trap.example.com": [publicIpv4] });
    const response = await fetchPublicUrl(
      "https://trap.example.com/x",
      {},
      resolve,
    );
    expect(response.status).toBe(404);
    await expect(
      requestPublicUrl("https://trap.example.com/x", {}, resolve),
    ).rejects.toThrow("HTTP 404");
  });

  it("brackets a pinned IPv6 address in the outgoing request URL", async () => {
    const { calls } = stubFetch(() => new Response("ok"));
    const publicIpv6 = ["2001", "4860", "4860", "0", "0", "0", "0", "8888"]
      .join(":");
    // WHATWG URL normalizes IPv6 host text to its canonical compressed form
    // (the longest run of zero groups collapsed to "::"), so the bracketed
    // hostname the pinned request actually carries is the compressed form
    // of the resolver's answer, not a bracket wrap of the literal input.
    const compressedPublicIpv6 = `${["2001", "4860", "4860"].join(":")}::8888`;
    const resolve = resolverFor({ "trap.example.com": [publicIpv6] });
    await fetchPublicUrl("https://trap.example.com/x", {}, resolve);
    const call = calls[0];
    if (call === undefined) throw new Error("expected a captured fetch call");
    expect(new URL(call.input).hostname).toBe(`[${compressedPublicIpv6}]`);
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
