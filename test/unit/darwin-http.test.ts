import { describe, expect, it } from "bun:test";
import {
  loadDarwinServerConfig,
  makeDarwinFetchHandler,
} from "../../darwin/runtime/http";

describe("darwin runtime http helpers", () => {
  it("loads loopback config and rejects invalid bindings", () => {
    expect(
      loadDarwinServerConfig(
        ["--host", "127.0.0.1", "--port", "9077", "--maximum-jobs", "2"],
        { ELLIOTT_DARWIN_TOKEN: "secret" },
      ),
    ).toEqual({
      host: "127.0.0.1",
      port: 9077,
      maximumJobs: 2,
      token: "secret",
    });
    expect(() =>
      loadDarwinServerConfig(["--host", "0.0.0.0"], {
        ELLIOTT_DARWIN_TOKEN: "secret",
      })
    ).toThrow("loopback");
    expect(() =>
      loadDarwinServerConfig(["--port", "0"], {
        ELLIOTT_DARWIN_TOKEN: "secret",
      })
    ).toThrow("positive integer");
    expect(() => loadDarwinServerConfig([], {})).toThrow(
      "ELLIOTT_DARWIN_TOKEN",
    );
    expect(
      loadDarwinServerConfig([], { ELLIOTT_DARWIN_FIXTURE: "1" }, true).token,
    ).toBe("");
  });

  it("authorizes, gates concurrency, and serves health checks", async () => {
    const handler = makeDarwinFetchHandler(
      {
        host: "127.0.0.1",
        port: 9073,
        maximumJobs: 1,
        token: "secret",
      },
      {
        "/v1/echo": (value) => value,
        "/v1/slow": async () => {
          await Bun.sleep(20);
          return { ok: true };
        },
      },
    );
    const health = await handler(
      new Request("http://127.0.0.1/healthz"),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const jsonHeaders = {
      authorization: "Bearer secret",
      "content-type": "application/json",
      "content-length": "2",
    };
    const unauthorized = await handler(
      new Request("http://127.0.0.1/v1/echo", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2" },
        body: "{}",
      }),
    );
    expect(unauthorized.status).toBe(401);

    const missing = await handler(
      new Request("http://127.0.0.1/v1/missing", {
        method: "POST",
        headers: jsonHeaders,
        body: "{}",
      }),
    );
    expect(missing.status).toBe(404);

    const echoBody = JSON.stringify({ hello: "world" });
    const ok = await handler(
      new Request("http://127.0.0.1/v1/echo", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(echoBody)),
        },
        body: echoBody,
      }),
    );
    expect(await ok.json()).toEqual({ hello: "world" });

    const slow = handler(
      new Request("http://127.0.0.1/v1/slow", {
        method: "POST",
        headers: jsonHeaders,
        body: "{}",
      }),
    );
    const limited = await handler(
      new Request("http://127.0.0.1/v1/echo", {
        method: "POST",
        headers: jsonHeaders,
        body: "{}",
      }),
    );
    expect(limited.status).toBe(429);
    await slow;
  });
});
