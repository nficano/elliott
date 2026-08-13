import { describe, expect, it } from "bun:test";
import { probeLlm } from "../../src/runtime/doctor/probe";
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
});
