import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { GlitchTipSink } from "../../../skills/glitchtip/src/sink";
import type { TransmittableError } from "../../../src/runtime/types";

const OVERFLOW_CAP = 100;
const OVERFLOW_TOTAL = 150;
const OVERFLOW_DROPPED = OVERFLOW_TOTAL - OVERFLOW_CAP;

const target = {
  endpoint: "http://127.0.0.1:9080/api/1/envelope/",
  publicKey: "supersecretpublickey",
};

const makeSink = (): GlitchTipSink =>
  new GlitchTipSink({ target, environment: "prod", release: "1.0.0" });

const capturedError = (): TransmittableError => ({
  name: "Error",
  frames: ["at handleTurn (/app/loop.ts:10:5)"],
  mechanism: "turn",
  timestamp: "2026-08-12T00:00:00.000Z",
});

// Let the fire-and-forget drain (an awaited fetch) settle.
const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const stubFetch = (
  handler: (init: RequestInit) => Promise<Response>,
): { readonly calls: readonly { url: string; init: RequestInit; }[]; } => {
  const calls: { url: string; init: RequestInit; }[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const resolved = init ?? {};
    calls.push({ url: String(input), init: resolved });
    return handler(resolved);
  };
  spyOn(globalThis, "fetch").mockImplementation(
    impl as unknown as typeof fetch,
  );
  return { calls };
};

afterEach(() => {
  mock.restore();
});

describe("GlitchTipSink", () => {
  it("ships a captured error to the collector as an envelope", async () => {
    const { calls } = stubFetch(() =>
      Promise.resolve(new Response("ok", { status: 200 }))
    );
    const sink = makeSink();
    sink.capture(capturedError());
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(target.endpoint);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(headers["x-sentry-auth"]).toContain(
      "sentry_key=supersecretpublickey",
    );
    expect(String(calls[0]?.init.body).split("\n")).toHaveLength(3);
    expect(sink.service().health()).toEqual({ queued: 0, sent: 1, dropped: 0 });
  });

  it("keeps the public key out of the envelope body (payload is secret-free)", async () => {
    const { calls } = stubFetch(() =>
      Promise.resolve(new Response("ok", { status: 200 }))
    );
    makeSink().capture(capturedError());
    await tick();

    const body = String(calls[0]?.init.body);
    // The public key rides only in the auth header, never the payload.
    expect(body).not.toContain("supersecretpublickey");
    expect(body).not.toContain("api/1/envelope");
  });

  it("drops oldest past the cap and never crashes when the collector is unreachable", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    const sink = makeSink();
    for (let index = 0; index < OVERFLOW_TOTAL; index += 1) {
      // A failing collector must never let capture() throw.
      expect(() => sink.capture(capturedError())).not.toThrow();
    }
    await tick();

    const health = sink.service().health();
    expect(health["queued"]).toBe(OVERFLOW_CAP);
    expect(health["dropped"]).toBe(OVERFLOW_DROPPED);
    expect(health["sent"]).toBe(0);
  });

  it("stop() drops the queue and ignores further captures", async () => {
    stubFetch(() => Promise.reject(new Error("down")));
    const sink = makeSink();
    const service = sink.service();
    sink.capture(capturedError());
    void service.stop();
    sink.capture(capturedError());
    await tick();

    expect(service.health()).toEqual({ queued: 0, sent: 0, dropped: 0 });
  });
});
