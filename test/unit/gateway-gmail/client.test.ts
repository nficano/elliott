import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { makeGmailClient } from "../../../skills/gateway-gmail/src/client";
import type { TokenSource } from "../../../skills/gateway-gmail/src/types";

const fakeTokenSource: TokenSource = {
  token: async () => "fake-access-token",
};

// Same cassette pattern as test/unit/vault/tool.test.ts: stub the single
// network boundary (globalThis.fetch) and capture what was actually sent,
// so the DNS-pinning behavior (Host header, TLS SNI) is asserted directly
// rather than just "a request happened."
const stubFetch = (
  handler: (input: string | URL) => Response,
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
    return Promise.resolve(handler(input));
  };
  spyOn(globalThis, "fetch").mockImplementation(
    impl as unknown as typeof fetch,
  );
  return { calls };
};

afterEach(() => {
  mock.restore();
});

describe("gateway-gmail unsubscribe", () => {
  it("skips a non-https List-Unsubscribe URL without any network call", async () => {
    const { calls } = stubFetch(() => new Response("unreachable"));
    const client = makeGmailClient(fakeTokenSource);
    const outcome = await client.unsubscribe("mailto:unsub@example.com");
    expect(outcome).toEqual({
      ok: false,
      status: 0,
      method: "skipped-non-https",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects a literal private/loopback destination before any network call", async () => {
    const { calls } = stubFetch(() => new Response("unreachable"));
    const client = makeGmailClient(fakeTokenSource);
    await expect(client.unsubscribe("https://127.0.0.1/unsub")).rejects
      .toThrow("outside the public egress grant");
    expect(calls).toHaveLength(0);
  });

  it("POSTs One-Click unsubscribe and pins the connection to the validated address", async () => {
    const { calls } = stubFetch(() => new Response(null, { status: 204 }));
    const client = makeGmailClient(fakeTokenSource);
    const outcome = await client.unsubscribe("https://example.com/unsub?id=1");
    expect(outcome).toEqual({ ok: true, status: 204, method: "POST" });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("expected a captured fetch call");
    // Connects to a resolved address, not the literal "example.com" text —
    // proves the request went through the DNS-pinned path, not a naive
    // fetch(url) that would let the OS resolve the hostname a second time.
    expect(new URL(call.input).hostname).not.toBe("example.com");
    const headers = new Headers(call.init["headers"] as HeadersInit);
    expect(headers.get("host")).toBe("example.com");
    expect(
      (call.init["tls"] as { servername?: string; } | undefined)?.servername,
    )
      .toBe("example.com");
    expect(call.init["method"]).toBe("POST");
  });

  it("falls back to GET when the POST is not ok", async () => {
    let requestCount = 0;
    const { calls } = stubFetch(() => {
      requestCount += 1;
      return requestCount === 1
        ? new Response("nope", { status: 405 })
        : new Response(null, { status: 200 });
    });
    const client = makeGmailClient(fakeTokenSource);
    const outcome = await client.unsubscribe("https://example.com/unsub?id=2");
    expect(outcome).toEqual({ ok: true, status: 200, method: "GET" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init["method"]).toBe("POST");
    expect(calls[1]?.init["method"] ?? "GET").toBe("GET");
  });
});
