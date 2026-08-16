import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "../../skills/cloudflared/src/index";
import { readTunnelReadiness } from "../../skills/cloudflared/src/probe";
import type { TunnelReadiness } from "../../skills/cloudflared/src/types";
import type {
  SkillContext,
  SkillRegistration,
} from "../../src/runtime/skills/types";
import type { RuntimeSettings } from "../../src/runtime/types";

// A per-run directory rather than a fixed /tmp path (world-writable, and two
// concurrent runs would collide).
const stateDir = mkdtempSync(path.join(tmpdir(), "elliott-cloudflared-"));

// The scheduled tick fires `void check()`, so its probe resolves across several
// microtask hops. Yielding to the macrotask queue drains all of them; a single
// `await Promise.resolve()` only drains one and reads as a missing report.
const IMMEDIATE_MILLISECONDS = 0;
const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, IMMEDIATE_MILLISECONDS);
  });
};

const contextWith = (
  readyUrl: string | undefined,
  reports: { mechanism: string; message: string; }[],
): SkillContext =>
  ({
    settings: {
      ...(readyUrl !== undefined && { cloudflared: { readyUrl } }),
    } as unknown as RuntimeSettings,
    stateDirectory: stateDir,
    report: (error: unknown, mechanism: string) => {
      reports.push({
        mechanism,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  }) as unknown as SkillContext;

const serviceOf = (registration: SkillRegistration) => {
  const service = registration.services?.[0];
  if (service === undefined) throw new Error("no service registered");
  return service;
};

const UP: TunnelReadiness = { ready: true, readyConnections: 4 };
const DOWN: TunnelReadiness = {
  ready: false,
  readyConnections: 0,
  reason: "metrics endpoint unreachable",
};

describe("readTunnelReadiness", () => {
  it("treats a live tunnel with edge connections as ready", () => {
    expect(readTunnelReadiness({ readyConnections: 4 })).toEqual({
      ready: true,
      readyConnections: 4,
    });
  });

  // The case that makes this skill worth having: cloudflared answers 200 and
  // looks healthy to a naive check, while carrying no traffic at all.
  it("treats zero edge connections as NOT ready", () => {
    const result = readTunnelReadiness({ readyConnections: 0 });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("no edge connections");
  });

  it("treats an unparseable body as not ready rather than assuming health", () => {
    for (const body of [undefined, null, "ok", 42, []]) {
      expect(readTunnelReadiness(body).ready).toBe(false);
    }
  });
});

describe("cloudflared register", () => {
  it("registers nothing when no ready_url is configured", () => {
    expect(register(contextWith(undefined, []))).toEqual({});
  });

  it("reports the tunnel as down at boot, not one interval later", async () => {
    const reports: { mechanism: string; message: string; }[] = [];
    const service = serviceOf(
      register(contextWith("http://cloudflared:20241/ready", reports), {
        probe: async () => DOWN,
        now: () => 1000,
      }),
    );

    await service.start();
    await service.stop();

    expect(service.health?.()["ready"]).toBe(0);
    expect(service.health?.()["consecutiveFailures"]).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.mechanism).toBe("skill:cloudflared");
    expect(reports[0]?.message).toContain("not ready");
    // The operator needs to know the consequence, not just the state.
    expect(reports[0]?.message).toContain("Inbound webhooks");
  });

  it("surfaces a healthy tunnel without reporting", async () => {
    const reports: { mechanism: string; message: string; }[] = [];
    const service = serviceOf(
      register(contextWith("http://cloudflared:20241/ready", reports), {
        probe: async () => UP,
        now: () => 1000,
      }),
    );

    await service.start();
    await service.stop();

    expect(service.health?.()["ready"]).toBe(1);
    expect(service.health?.()["readyConnections"]).toBe(4);
    expect(reports).toEqual([]);
  });

  // A tunnel down for an hour is ONE incident. At a 30s poll, reporting every
  // failure would put 120 identical events into the error sink and, with
  // glitchtip attached, into off-box telemetry. Drives the real interval
  // callback rather than re-calling start(), which would test nothing.
  it("reports once per outage, not once per failed poll", async () => {
    const reports: { mechanism: string; message: string; }[] = [];
    let readiness: TunnelReadiness = DOWN;
    let tick: (() => void) | undefined;
    const service = serviceOf(
      register(contextWith("http://cloudflared:20241/ready", reports), {
        probe: async () => readiness,
        now: () => 1000,
        schedule: (fn) => {
          tick = fn;
          return () => {
            tick = undefined;
          };
        },
      }),
    );

    await service.start();
    expect(reports).toHaveLength(1);

    // Four more failed polls through the scheduled callback: still one incident.
    for (let poll = 0; poll < 4; poll += 1) tick?.();
    await flush();
    expect(reports).toHaveLength(1);

    // Recovery, then a second outage, is a NEW incident and must report again.
    readiness = UP;
    tick?.();
    await flush();
    readiness = DOWN;
    tick?.();
    await flush();
    expect(reports).toHaveLength(2);

    await service.stop();
    expect(tick).toBeUndefined();
  });

  it("start is idempotent, so a restart cannot strand a poll timer", async () => {
    const scheduled: (() => void)[] = [];
    const service = serviceOf(
      register(contextWith("http://cloudflared:20241/ready", []), {
        probe: async () => UP,
        now: () => 1000,
        schedule: (fn) => {
          scheduled.push(fn);
          return () => {};
        },
      }),
    );

    await service.start();
    await service.start();
    await service.start();
    await service.stop();

    expect(scheduled).toHaveLength(1);
  });
});
