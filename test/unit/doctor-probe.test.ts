import { describe, expect, it } from "bun:test";
import { invalidEndpointProbe, probeLlm } from "../../src/runtime/doctor/probe";
import type { RuntimeSettings } from "../../src/runtime/types";

const settings = {
  llmWire: "anthropic",
  llmBaseUrl: "https://api.anthropic.com/v1",
  model: "claude-haiku-4-5-20251001",
} as unknown as RuntimeSettings;

const ok = () => ({ complete: async () => ({ text: "ready", toolCalls: [] }) });
const throwing = (error: unknown) => () => ({
  complete: async () => {
    throw error;
  },
});

describe("probeLlm", () => {
  it("reports ok with the derived endpoint metadata, not the model's reply", async () => {
    const probe = await probeLlm(settings, ok);
    expect(probe.ok).toBe(true);
    expect(probe.wire).toBe("anthropic");
    expect(probe.model).toBe("claude-haiku-4-5-20251001");
    // The reply is endpoint-controlled and is deliberately not carried.
    expect((probe as { reply?: unknown; }).reply).toBeUndefined();
  });

  it("classifies an HTTP failure from the status, never echoing the body", async () => {
    const hostile = Object.assign(
      new Error("openai 401: {\"echoed\":\"Bearer sk-secret\"}"),
      { status: 401 },
    );
    const probe = await probeLlm(settings, throwing(hostile));
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("authentication rejected (HTTP 401)");
    expect(probe.error).not.toContain("sk-secret");
  });

  it("buckets other statuses into fixed phrases", async () => {
    const status = async (code: number) =>
      (await probeLlm(
        settings,
        throwing(Object.assign(new Error("body"), { status: code })),
      )).error;
    expect(await status(404)).toBe("model or endpoint not found (HTTP 404)");
    expect(await status(429)).toBe("rate limited (HTTP 429)");
    expect(await status(503)).toBe("endpoint server error (HTTP 503)");
  });

  it("classifies a non-HTTP failure as an unreachable endpoint", async () => {
    const probe = await probeLlm(
      settings,
      throwing(new Error("ECONNREFUSED private-host:8080")),
    );
    expect(probe.error).toBe("endpoint unreachable or did not respond");
    expect(probe.error).not.toContain("private-host");
  });

  it("reduces the endpoint to a credential-free origin", async () => {
    // A base URL carrying inline credentials (userinfo, and a path/query that
    // could hide a token) is shown only as its origin — scheme, host, port.
    const withCreds = {
      ...settings,
      llmBaseUrl: "https://user:password@example.com/v1?token=leak",
    } as unknown as RuntimeSettings;
    const probe = await probeLlm(withCreds, ok);
    expect(probe.baseUrl).toBe("https://example.com");
    expect(probe.baseUrl).not.toContain("password");
    expect(probe.baseUrl).not.toContain("leak");
  });

  it("fails a reachable-but-empty completion instead of passing on a fulfilled call", async () => {
    // A 200 that decodes to no text is reachable but useless: the probe proves
    // a usable completion, so a fulfilled-but-empty call is a distinct failure,
    // not a PASS.
    const empty = () => ({
      complete: async () => ({ text: "  ", toolCalls: [] }),
    });
    const probe = await probeLlm(settings, empty);
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("endpoint returned an empty completion");
  });

  it("classifies a decode failure as unreadable, distinct from unreachable", async () => {
    // A ModelDecodeError carries a `decode` marker: the endpoint was reached and
    // answered, but the bytes would not parse — a different diagnosis than a
    // host that never responded.
    const garbled = Object.assign(new Error("bad json at 0"), { decode: true });
    const probe = await probeLlm(settings, throwing(garbled));
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("endpoint returned an unreadable response");
  });

  it("redacts a resolved config value that surfaces in the model id or origin", async () => {
    // The model id and base URL are config-derived, so a credential mistakenly
    // placed there would otherwise print. The recorded secret set (arg 3) scrubs
    // it — defense in depth behind reference enforcement.
    const leaky = {
      ...settings,
      model: "model-sk-live-abc123",
      llmBaseUrl: "https://sk-live-abc123@host.example/v1",
    } as unknown as RuntimeSettings;
    const probe = await probeLlm(leaky, ok, ["sk-live-abc123"]);
    expect(probe.model).not.toContain("sk-live-abc123");
    expect(probe.model).toContain("‹redacted›");
    expect(probe.baseUrl).not.toContain("sk-live-abc123");
  });
});

describe("invalidEndpointProbe", () => {
  it("reports a derived failure for an unparseable base URL without echoing it", () => {
    // A base_url that will not parse would otherwise throw a TypeError carrying
    // the raw URL — which can embed a credential — to an outer handler. Instead
    // the endpoint is shown as a fixed placeholder and the failure is its own
    // phrase; a secret embedded in the literal is redacted by the recorded set.
    const bad = {
      llmWire: "openai",
      llmBaseUrl: "not-a-url-sk-live-abc123",
      model: "m",
    } as unknown as RuntimeSettings;
    const probe = invalidEndpointProbe(bad, ["sk-live-abc123"]);
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("endpoint is not a valid URL");
    expect(probe.baseUrl).toBe("(unparseable endpoint)");
    expect(JSON.stringify(probe)).not.toContain("sk-live-abc123");
  });
});
