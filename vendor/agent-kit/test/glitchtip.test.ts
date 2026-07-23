import { describe, expect, test } from "bun:test";
import { ConfigError, ToolError } from "../src/core/errors.js";
import { validate } from "../src/host/config/load.js";
import {
  buildErrorReporter,
  buildEvent,
  makeGlitchtip,
  noopReporter,
  parseDsn,
  parseStack,
} from "../src/host/observability/glitchtip.js";
import type {
  GlitchtipFetch,
  GlitchtipOpts,
} from "../src/host/observability/types.js";

const DSN = "https://pubkey@errors.example.com/7";

function recordingFetch() {
  const calls: { url: string; init: Parameters<GlitchtipFetch>[1]; }[] = [];
  const fetchImpl: GlitchtipFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  return { calls, fetchImpl };
}

function reporterWith(opts: Partial<GlitchtipOpts> = {}) {
  const { calls, fetchImpl } = recordingFetch();
  const reporter = makeGlitchtip({ dsn: DSN, fetchImpl, ...opts });
  return { calls, reporter };
}

describe("glitchtip: parseDsn", () => {
  test("extracts origin, projectId, and publicKey from a valid DSN", () => {
    expect(parseDsn("https://abc123@glitchtip.example.com/4")).toEqual({
      origin: "https://glitchtip.example.com",
      projectId: "4",
      publicKey: "abc123",
    });
  });

  test("keeps port and path prefix in the origin", () => {
    // eslint-disable-next-line unicorn/prefer-https -- self-hosted DSNs may be plain http on an internal network.
    expect(parseDsn("http://key@host.internal:8000/prefix/12")).toEqual({
      // eslint-disable-next-line unicorn/prefer-https -- mirrors the http DSN above.
      origin: "http://host.internal:8000/prefix",
      projectId: "12",
      publicKey: "key",
    });
  });

  test.each([
    "not a url",
    "https://glitchtip.example.com/4", // no public key
    "https://key@glitchtip.example.com/", // no project id
    "redis://key@glitchtip.example.com/4", // not http(s)
  ])("malformed DSN %p throws ConfigError at boot", (dsn) => {
    expect(() => parseDsn(dsn)).toThrow(ConfigError);
  });

  test("makeGlitchtip surfaces the ConfigError at construction, not capture", () => {
    expect(() => makeGlitchtip({ dsn: "garbage" })).toThrow(ConfigError);
  });
});

describe("glitchtip: parseStack", () => {
  test("parses a real thrown Bun error: names, files, oldest-first order", () => {
    function glitchtipInnermost(): never {
      throw new Error("boom");
    }
    function glitchtipOutermost(): never {
      glitchtipInnermost();
    }
    let caught: Error | undefined;
    try {
      glitchtipOutermost();
    } catch (error) {
      caught = error as Error;
    }
    const frames = parseStack(caught);
    const names = frames.map((frame) => frame.function ?? "");
    const inner = names.findIndex((name) =>
      name.includes("glitchtipInnermost")
    );
    const outer = names.findIndex((name) =>
      name.includes("glitchtipOutermost")
    );
    expect(inner).toBeGreaterThanOrEqual(0);
    expect(outer).toBeGreaterThanOrEqual(0);
    // Oldest call first per Sentry: the throw site is the LAST frame.
    expect(outer).toBeLessThan(inner);
    const throwSite = frames[inner];
    expect(throwSite.filename).toContain("glitchtip.test.ts");
    expect(throwSite.in_app).toBe(true);
    expect(throwSite.lineno).toBeGreaterThan(0);
    expect(throwSite.colno).toBeGreaterThan(0);
  });

  test("parses fixture forms: async, anonymous, new, node_modules, file://", () => {
    const error = new Error("fixture");
    // eslint-disable-next-line unicorn/no-error-property-assignment -- a deterministic stack fixture is the whole point of this test.
    error.stack = [
      "Error: fixture",
      "    at innerFn (file:///app/src/inner.ts:10:5)",
      "    at async outerFn (/app/node_modules/lib/index.js:3:1)",
      "    at /app/src/anon.ts:7:9",
      "    at new Thing (node:internal/foo:1:1)",
      "    at <anonymous> (bun:main:2:2)",
    ].join("\n");
    const frames = parseStack(error);
    expect(frames).toHaveLength(5);
    // Reversed: oldest (bottom of the printed stack) first.
    expect(frames[0]).toEqual({
      filename: "bun:main",
      lineno: 2,
      colno: 2,
      in_app: false,
    });
    expect(frames[1]).toEqual({
      filename: "node:internal/foo",
      function: "new Thing",
      lineno: 1,
      colno: 1,
      in_app: false,
    });
    expect(frames[2]).toEqual({
      filename: "/app/src/anon.ts",
      lineno: 7,
      colno: 9,
      in_app: true,
    });
    expect(frames[3]).toEqual({
      filename: "/app/node_modules/lib/index.js",
      function: "outerFn",
      lineno: 3,
      colno: 1,
      in_app: false,
    });
    expect(frames[4]).toEqual({
      filename: "/app/src/inner.ts",
      function: "innerFn",
      lineno: 10,
      colno: 5,
      in_app: true,
    });
  });
});

describe("glitchtip: buildEvent", () => {
  test("walks the cause chain into exception.values, innermost first", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    const event = buildEvent(top, { mechanism: "test", handled: true });
    expect(event.exception.values.map((value) => value.value)).toEqual([
      "root",
      "mid",
      "top",
    ]);
    for (const value of event.exception.values) {
      expect(value.mechanism).toEqual({ type: "test", handled: true });
    }
    expect(event.platform).toBe("javascript");
    expect(event.level).toBe("error");
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  test("caps the cause chain at 5 values", () => {
    let error = new Error("depth-0");
    for (let depth = 1; depth < 8; depth += 1) {
      error = new Error(`depth-${depth}`, { cause: error });
    }
    const event = buildEvent(error, {});
    expect(event.exception.values).toHaveLength(5);
    // The outermost error is always last (newest per Sentry ordering).
    expect(event.exception.values[4]?.value).toBe("depth-7");
  });

  test("tagged errors report their _tag as the exception type", () => {
    const event = buildEvent(new ToolError({ message: "nope" }), {});
    expect(event.exception.values[0]?.type).toBe("ToolError");
  });

  test("a non-Error throwable synthesizes a value with synthetic: true", () => {
    const event = buildEvent("kaboom", { mechanism: "turn" });
    expect(event.exception.values).toHaveLength(1);
    expect(event.exception.values[0]).toEqual({
      type: "Error",
      value: "kaboom",
      mechanism: { type: "turn", handled: true, synthetic: true },
    });
  });

  test("defaults mechanism to generic and honors handled: false", () => {
    const event = buildEvent(new Error("x"), { handled: false });
    expect(event.exception.values[0]?.mechanism.type).toBe("generic");
    expect(event.exception.values[0]?.mechanism.handled).toBe(false);
  });
});

describe("glitchtip: captureException wire format", () => {
  test("POSTs the store endpoint with X-Sentry-Auth and a full event", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const reporter = makeGlitchtip({
      dsn: DSN,
      environment: "test",
      release: "1.2.3",
      serverName: "spruce",
      fetchImpl,
    });
    reporter.captureException(new Error("boom"), {
      mechanism: "turn",
      tags: { agent: "main", conversation: "c1" },
      extra: { attempt: 2 },
    });
    await reporter.flush(1000);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe("https://errors.example.com/api/7/store/");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers["Content-Type"]).toBe("application/json");
    expect(call.init.headers["X-Sentry-Auth"]).toBe(
      "Sentry sentry_version=7, sentry_key=pubkey, "
        + "sentry_client=agent-kit/0.0.0",
    );
    const body = JSON.parse(call.init.body) as Record<string, unknown>;
    expect(body.platform).toBe("javascript");
    expect(body.environment).toBe("test");
    expect(body.release).toBe("1.2.3");
    expect(body.server_name).toBe("spruce");
    expect(body.tags).toEqual({ agent: "main", conversation: "c1" });
    expect(body.extra).toEqual({ attempt: 2 });
    const exception = body.exception as {
      values: { value: string; stacktrace?: { frames: unknown[]; }; }[];
    };
    expect(exception.values[0]?.value).toBe("boom");
    expect(exception.values[0]?.stacktrace?.frames.length).toBeGreaterThan(0);
  });

  test("never throws when fetch rejects, and onError fires once per N", async () => {
    const hookCalls: number[] = [];
    const reporter = makeGlitchtip({
      dsn: DSN,
      fetchImpl: () => Promise.reject(new Error("network down")),
      onError: (_cause, failures) => hookCalls.push(failures),
    });
    expect(() => reporter.captureException(new Error("a"))).not.toThrow();
    await reporter.flush(1000);
    expect(hookCalls).toEqual([1]);

    for (let index = 0; index < 9; index += 1) {
      reporter.captureException(new Error(`bulk-${index}`));
    }
    await reporter.flush(1000);
    expect(hookCalls).toEqual([1]); // failures 2..10 stay quiet

    reporter.captureException(new Error("eleventh"));
    await reporter.flush(1000);
    expect(hookCalls).toEqual([1, 11]); // fires again at N+1
  });

  test("dedupes the same error object propagating through stacked seams", async () => {
    const { calls, reporter } = reporterWith();
    const error = new Error("once");
    reporter.captureException(error, { mechanism: "turn" });
    reporter.captureException(error, { mechanism: "job" });
    await reporter.flush(1000);
    expect(calls).toHaveLength(1);
  });

  test("flush waits for in-flight sends", async () => {
    let settled = false;
    const reporter = makeGlitchtip({
      dsn: DSN,
      fetchImpl: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ ok: true, status: 200 });
          }, 50)
        ),
    });
    reporter.captureException(new Error("slow"));
    expect(settled).toBe(false);
    await reporter.flush(1000);
    expect(settled).toBe(true);
  });

  test("flush gives up after its timeout when a send hangs", async () => {
    const reporter = makeGlitchtip({
      dsn: DSN,
      fetchImpl: () => new Promise(() => {}), // never settles
    });
    reporter.captureException(new Error("hang"));
    const started = Date.now();
    await reporter.flush(20);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("glitchtip: config wiring (§5 optional-section semantics)", () => {
  const baseConfig = {
    store: { dsn: "postgres://x" },
    llm: {
      base_url: "https://litellm",
      api_key: "k",
      models: {
        utility: { model: "tier-local" },
        trivial: { model: "tier-local" },
        fast: { model: "anthropic/claude-haiku-4-5" },
        standard: { model: "anthropic/claude-sonnet-5" },
        deep: { model: "anthropic/claude-opus-4-8" },
        embed: { model: "tier-local-embed" },
      },
      profiles: { default: {} },
    },
  };

  test("schema accepts an observability.glitchtip section", () => {
    const cfg = validate({
      ...baseConfig,
      observability: {
        otel: { endpoint: "http://collector:4318" },
        glitchtip: { dsn: DSN, environment: "prod", release: "abc123" },
      },
    });
    expect(cfg.observability?.glitchtip).toEqual({
      dsn: DSN,
      environment: "prod",
      release: "abc123",
    });
  });

  test("schema accepts observability without the glitchtip section", () => {
    const cfg = validate({
      ...baseConfig,
      observability: { otel: { endpoint: "http://collector:4318" } },
    });
    expect(cfg.observability?.glitchtip).toBeUndefined();
  });

  test("buildErrorReporter: configured section yields a live reporter", () => {
    const cfg = validate({
      ...baseConfig,
      observability: {
        otel: { endpoint: "http://collector:4318" },
        glitchtip: { dsn: DSN },
      },
    });
    const reporter = buildErrorReporter({
      glitchtip: cfg.observability!.glitchtip!,
      environment: "test",
    });
    expect(reporter).not.toBe(noopReporter);
  });

  test("buildErrorReporter: absent section yields the noop reporter", () => {
    const reporter = buildErrorReporter({ environment: "test" });
    expect(reporter).toBe(noopReporter);
    expect(() => reporter.captureException(new Error("ignored"))).not.toThrow();
  });

  test("buildErrorReporter: invalid DSN reports once and disables, not throws", () => {
    const invalid: string[] = [];
    const reporter = buildErrorReporter({
      glitchtip: { dsn: "garbage" },
      environment: "test",
      onInvalid: (message) => invalid.push(message),
    });
    expect(reporter).toBe(noopReporter);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toContain("glitchtip");
  });
});
