/* eslint-disable no-magic-numbers */
import { describe, expect, test } from "bun:test";
import { type CompanionServerConfig, makeCompanionFetchHandler } from "./http";
import {
  errorResponse,
  MAX_REQUEST_BYTES,
  readJsonRequest,
  requireLoopbackEndpoint,
} from "./wire";

const start = () => {
  const config: CompanionServerConfig = {
    host: "127.0.0.1",
    port: 9073,
    maximumJobs: 1,
    token: "test-secret",
  };
  return makeCompanionFetchHandler(config, {
    "/v1/echo": (value) => value,
  });
};

const expectRejectedStatus = async (
  promise: Promise<unknown>,
  status: number,
): Promise<void> => {
  const result = await promise
    .then(() => undefined)
    .catch((error: unknown) => error);
  expect(result).toMatchObject({ status });
};

describe("TypeScript companion HTTP boundary", () => {
  test("leaves health unauthenticated", async () => {
    const handler = start();
    const response = await handler(
      new Request("http://127.0.0.1:9073/healthz"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("requires the configured bearer token", async () => {
    const handler = start();
    const unauthorized = await handler(
      new Request("http://127.0.0.1:9073/v1/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }),
    );
    expect(unauthorized.status).toBe(401);
    const authorized = await handler(
      new Request("http://127.0.0.1:9073/v1/echo", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-length": String(Buffer.byteLength("{\"ok\":true}")),
          "content-type": "application/json",
        },
        body: JSON.stringify({ ok: true }),
      }),
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true });
  });
});

describe("TypeScript companion wire boundary", () => {
  test("rejects malformed request framing and JSON", async () => {
    const request = (length?: string, body?: string) =>
      new Request("http://127.0.0.1:9073/v1/echo", {
        method: "POST",
        headers: length === undefined ? {} : { "content-length": length },
        body,
      });

    await expectRejectedStatus(readJsonRequest(request()), 400);
    await expectRejectedStatus(readJsonRequest(request("invalid")), 400);
    await expectRejectedStatus(
      readJsonRequest(request(String(MAX_REQUEST_BYTES + 1))),
      413,
    );
    await expectRejectedStatus(readJsonRequest(request("2", "{")), 400);
    await expectRejectedStatus(readJsonRequest(request("1", "{")), 400);
  });

  test("accepts only authenticated loopback companion endpoints", () => {
    const config = requireLoopbackEndpoint(
      "http://127.0.0.1:9073",
      "secret",
      "benchmark",
    );
    expect(config.endpoint.hostname).toBe("127.0.0.1");
    expect(config.token).toBe("secret");
    expect(() => requireLoopbackEndpoint(undefined, "secret", "benchmark"))
      .toThrow();
    expect(() => requireLoopbackEndpoint("not a URL", "secret", "benchmark"))
      .toThrow();
    expect(() =>
      requireLoopbackEndpoint("https://example.com", "secret", "benchmark")
    ).toThrow();
  });

  test("normalizes unexpected errors without leaking arbitrary values", async () => {
    const error = errorResponse(new Error("boom"));
    expect(error.status).toBe(500);
    expect(await error.json()).toEqual({ error: "Error: boom" });

    const unknown = errorResponse({ secret: "do not serialize" });
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "unknown server error" });
  });
});
