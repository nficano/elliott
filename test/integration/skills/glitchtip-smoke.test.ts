import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { RuntimeErrorReporter } from "../../../src/runtime/reporter";
import { loadOneSkill, makeSmokeContext, stubFetch } from "./fixtures";

// Tier-1: the glitchtip skill through the real loader path. It self-gates on
// settings.glitchtip, so the enabled/disabled/user-DSN/unreachable matrix is
// driven purely by the settings the runtime would resolve.

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

afterEach(() => {
  mock.restore();
});

describe("glitchtip skill (Tier 1)", () => {
  it("is a pure no-op when disabled — no sink, no service, no log", async () => {
    // Base smoke settings carry no `glitchtip` block: reporting is off. Spy on
    // every console channel to prove the disabled path says nothing at load.
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const { context, sinks, reported } = await makeSmokeContext();
    const registration = await loadOneSkill("glitchtip", context);

    expect(registration.services ?? []).toHaveLength(0);
    expect(sinks).toHaveLength(0);
    expect(reported).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("installs a sink and a health service when enabled", async () => {
    const { context, sinks, reported } = await makeSmokeContext({
      glitchtip: { dsn: "http://pub@127.0.0.1:9/1" },
    });
    const registration = await loadOneSkill("glitchtip", context);

    expect(reported).toEqual([]);
    expect(sinks).toHaveLength(1);
    expect(registration.services).toHaveLength(1);
    const service = registration.services?.[0];
    expect(service?.name).toBe("glitchtip");
    for (const value of Object.values(service?.health?.() ?? {})) {
      expect(typeof value).toBe("number");
    }
  });

  it("routes to an operator-supplied DSN (own Sentry/GlitchTip)", async () => {
    const { context, sinks } = await makeSmokeContext({
      glitchtip: { dsn: "https://key@sentry.example/42" },
    });
    await loadOneSkill("glitchtip", context);
    const { calls } = stubFetch([{ match: "sentry.example", body: "ok" }]);

    sinks[0]?.capture({
      name: "Error",
      message: "boom",
      mechanism: "turn",
      timestamp: "2026-08-12T00:00:00.000Z",
    });
    await tick();

    expect(calls).toEqual(["https://sentry.example/api/42/envelope/"]);
  });

  it("keeps serving when the collector is unreachable", async () => {
    const { context, sinks } = await makeSmokeContext({
      glitchtip: { dsn: "http://pub@127.0.0.1:9080/1" },
    });
    await loadOneSkill("glitchtip", context);
    stubFetch([]); // no cassette route -> every send rejects

    expect(() =>
      sinks[0]?.capture({
        name: "Error",
        message: "boom",
        mechanism: "turn",
        timestamp: "2026-08-12T00:00:00.000Z",
      })
    ).not.toThrow();
    await tick();
  });

  it("ships no DSN, token, or Vault path in the captured payload", async () => {
    // The end-to-end path: runtime reporter -> installed glitchtip sink -> POST.
    // Settings hold a real DSN (public key) and a Vault token/path, but a normal
    // captured error carries none of them, and the reporter never adds settings.
    const { context, sinks } = await makeSmokeContext({
      glitchtip: { dsn: "https://leakykey@sentry.example/1" },
      vault: {
        address: "https://vault.example",
        token: "hvs.LEAKYTOKEN",
        paths: ["secret/data/private"],
      },
    });
    await loadOneSkill("glitchtip", context);

    const bodies: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(
      ((
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        bodies.push(String(init?.body));
        return Promise.resolve(new Response("ok", { status: 200 }));
      }) as unknown as typeof fetch,
    );

    const reporter = new RuntimeErrorReporter();
    const sink = sinks[0];
    if (sink !== undefined) reporter.addSink(sink);
    reporter.capture(new Error("upstream 500"), "turn");
    await tick();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("leakykey");
    expect(bodies[0]).not.toContain("hvs.LEAKYTOKEN");
    expect(bodies[0]).not.toContain("secret/data/private");
    expect(bodies[0]).toContain("upstream 500");
  });

  it("degrades to console-only on a malformed DSN without leaking it", async () => {
    // Parses as a URL but is not a valid Sentry DSN (no public key / project),
    // so parseDsn throws. The token-like host must not survive into the report.
    const secretish = "http://tok3n";
    const { context, sinks, reported } = await makeSmokeContext({
      glitchtip: { dsn: secretish },
    });
    const registration = await loadOneSkill("glitchtip", context);

    expect(registration.services ?? []).toHaveLength(0);
    expect(sinks).toHaveLength(0);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("glitchtip:config");
    expect(reported[0]).not.toContain("tok3n");
  });
});
