import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { ServiceGet } from "../src/core/di/services.js";
import { McpError } from "../src/core/errors.js";
import {
  degradeForModel,
  makeCapabilityBus,
} from "../src/host/capabilities/bus.js";
import { makeStandardCatalog } from "../src/host/capabilities/contracts.js";
import { CapabilityError } from "../src/host/capabilities/errors.js";
import type { AgentKitConfig } from "../src/host/config/schema.js";
import type { FootprintLedger } from "../src/host/footprint/types.js";
import type { Observability } from "../src/host/observability/types.js";
import { makeRegistry } from "../src/host/registry/registry.js";
import type { Registrable, Registry } from "../src/host/registry/types.js";
import type { MkSkillOpts } from "./types.js";

/** No runtime services needed for registry unit tests; activate() paths here don't reach for one. */
const noServices: ServiceGet = (tag) => {
  throw new Error(`test: no service ${tag.key}`);
};

// ── Effect assertion helpers ──
// Run an Effect that must fail and return the typed error (the `._unsafeUnwrapErr()` analog).
async function runFail<A, E>(eff: Effect.Effect<A, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) {
    throw new Error(
      `expected failure, got success: ${JSON.stringify(result.success)}`,
    );
  }
  return result.failure;
}

// ── shared fakes ──

function fakeObs(errors: string[]): Observability {
  return {
    span: (
      _n: string,
      _a: Record<string, unknown>,
      fn: () => Promise<unknown>,
    ) => fn(),
    recordError: (_tag: string, message: string) => {
      errors.push(message);
    },
  } as unknown as Observability;
}

const fakeFootprint = { recordStatic: () => {} } as unknown as FootprintLedger;

function cfgWith(
  skills: Record<string, Record<string, unknown>>,
): AgentKitConfig {
  return {
    skills,
    mcp: {},
    plugins: {},
    agents: {},
    channels: {},
    capabilities: {},
  } as unknown as AgentKitConfig;
}

function mkSkill(opts: MkSkillOpts): Registrable {
  return {
    manifest: {
      id: opts.id,
      kind: "skill",
      version: opts.version ?? "1.0.0",
      configSchema: Schema.Struct({}, {
        key: Schema.String,
        value: Schema.Unknown,
      }),
      ...(opts.provides && { provides: opts.provides }),
      ...(opts.secrets && { secrets: opts.secrets }),
    },
    async activate(ctx) {
      opts.onActivate?.({ ...ctx.secrets });
      return opts.active ?? {};
    },
  };
}

function mkRegistry(
  skills: Record<string, Record<string, unknown>>,
  registrables: Registrable[],
  errors: string[] = [],
): Registry {
  const registry = makeRegistry({
    config: cfgWith(skills),
    get: noServices,
    obs: fakeObs(errors),
    footprint: fakeFootprint,
    catalog: makeStandardCatalog(),
  });
  registry.index(registrables);
  return registry;
}

// ── registry: opt-in enablement (TDD §5) ──

describe("registry opt-in enablement", () => {
  test("a present config block WITHOUT enabled:true does not enable", async () => {
    const registry = mkRegistry({ a: { some_field: 1 } }, [
      mkSkill({ id: "a" }),
    ]);
    expect(registry.get("a")?.enabled).toBe(false);
    await expect(registry.activate("a")).rejects.toThrow("disabled");
  });

  test("enabled: true activates; absent block stays disabled", async () => {
    const registry = mkRegistry({ a: { enabled: true } }, [
      mkSkill({ id: "a" }),
      mkSkill({ id: "b" }),
    ]);
    expect(registry.get("a")?.enabled).toBe(true);
    await registry.activate("a");
    expect(registry.get("b")?.enabled).toBe(false);
  });
});

// ── registry: secrets (TDD §6) ──

describe("registry secrets scoping", () => {
  test("declared secrets are delivered, and only those", async () => {
    let seen: Record<string, string> = {};
    const registry = mkRegistry(
      { a: { enabled: true, secrets: { api_key: "s3cr3t" } } },
      [mkSkill({
        id: "a",
        secrets: [{ name: "api_key" }],
        onActivate: (s) => (seen = s),
      })],
    );
    await registry.activate("a");
    expect(seen).toEqual({ api_key: "s3cr3t" });
  });

  test("an undeclared supplied secret disables the registrable", () => {
    const errors: string[] = [];
    const registry = mkRegistry(
      { a: { enabled: true, secrets: { rogue: "x" } } },
      [mkSkill({ id: "a", secrets: [{ name: "api_key", required: false }] })],
      errors,
    );
    expect(registry.get("a")?.enabled).toBe(false);
    expect(errors.join(",")).toContain("not declared");
  });

  test("a missing required secret disables; optional may be absent", () => {
    const errors: string[] = [];
    const registry = mkRegistry(
      { a: { enabled: true }, b: { enabled: true } },
      [
        mkSkill({ id: "a", secrets: [{ name: "api_key" }] }),
        mkSkill({ id: "b", secrets: [{ name: "api_key", required: false }] }),
      ],
      errors,
    );
    expect(registry.get("a")?.enabled).toBe(false);
    expect(registry.get("b")?.enabled).toBe(true);
    expect(errors.join(",")).toContain("required secret 'api_key' missing");
  });
});

// ── registry: provides validation (TDD §3.3) ──

describe("provides validation", () => {
  test("multiple enabled providers for one ref coexist; config selection decides who runs", () => {
    const errors: string[] = [];
    const registry = mkRegistry(
      { a: { enabled: true }, b: { enabled: true } },
      [
        mkSkill({ id: "a", provides: [{ capability: "page-fetch@1" }] }),
        mkSkill({ id: "b", provides: [{ capability: "page-fetch@1" }] }),
      ],
      errors,
    );
    expect(registry.get("a")?.enabled).toBe(true);
    expect(registry.get("b")?.enabled).toBe(true);
    expect(errors).toEqual([]);
    expect(
      registry.providersOf("page-fetch@1").sort((a, b) => a.localeCompare(b)),
    ).toEqual(["a", "b"]);
  });

  test("an unknown capability ref disables the registrable", () => {
    const errors: string[] = [];
    const registry = mkRegistry(
      { a: { enabled: true }, c: { enabled: true } },
      [
        mkSkill({ id: "a", provides: [{ capability: "page-fetch@1" }] }),
        mkSkill({ id: "c", provides: [{ capability: "nope@1" }] }),
      ],
      errors,
    );
    expect(registry.providersOf("page-fetch@1")).toEqual(["a"]);
    expect(registry.get("c")?.enabled).toBe(false);
    expect(errors.join(",")).toContain("unknown capability");
  });

  test("a declared provider that never registers its impl fails activation", async () => {
    const registry = mkRegistry(
      { a: { enabled: true } },
      [mkSkill({
        id: "a",
        provides: [{ capability: "page-fetch@1" }],
        active: {},
      })],
    );
    await expect(registry.activate("a")).rejects.toThrow("never registered");
  });
});

// ── registry: version resolution (TDD §7) ──

describe("version resolution", () => {
  test("highest version wins by default; config range pins; losers are shadowed", () => {
    const v1 = mkSkill({ id: "a", version: "1.4.0" });
    const v2 = mkSkill({ id: "a", version: "2.0.0" });

    const latest = mkRegistry({ a: { enabled: true } }, [v1, v2]);
    expect(latest.get("a")?.registrable.manifest.version).toBe("2.0.0");
    expect(latest.inventory().find((i) => i.shadowed)?.version).toBe("1.4.0");

    const pinned = mkRegistry({ a: { enabled: true, version: "^1" } }, [
      v1,
      v2,
    ]);
    expect(pinned.get("a")?.registrable.manifest.version).toBe("1.4.0");
  });

  test("no satisfying version disables with an error event", () => {
    const errors: string[] = [];
    const registry = mkRegistry(
      { a: { enabled: true, version: "^3" } },
      [mkSkill({ id: "a", version: "2.0.0" })],
      errors,
    );
    expect(registry.get("a")?.enabled).toBe(false);
    expect(errors.join(",")).toContain("satisfies");
  });
});

// ── the bus (TDD §3.5, §8) ──

function busWith(
  providers: Record<string, Active>,
  selections: Record<string, { provider: string; fallback: string[]; }>,
) {
  const actives = new Map(Object.entries(providers));
  const registry = {
    activate: async (id: string) => {
      const a = actives.get(id);
      if (!a) throw new Error(`no '${id}'`);
      return a;
    },
    get: (id: string) =>
      actives.has(id)
        ? ({
          registrable: { manifest: { id, version: "1.0.0" } },
        } as ReturnType<Registry["get"]>)
        : undefined,
  } as Pick<Registry, "activate" | "get">;
  return makeCapabilityBus({
    catalog: makeStandardCatalog(),
    registry,
    selections,
  });
}

describe("capability bus", () => {
  const fetchOk: Active = {
    providers: [
      {
        capability: "page-fetch@1",
        invoke: async () => ({ status: 200, content: "hi", format: "text" }),
      },
    ],
  };

  test("unconfigured ref degrades (and degradeForModel says unavailable)", async () => {
    const bus = busWith({}, {});
    const error = await runFail(
      bus.invoke("page-fetch@1", { url: "https://x" }),
    );
    expect(error.reason).toBe("unconfigured");
    expect(JSON.parse(degradeForModel(error)).mode).toBe("unavailable");
    expect(bus.available("page-fetch@1")).toBe(false);
  });

  test("unknown ref and bad input are typed failures", async () => {
    const bus = busWith({ w: fetchOk }, {
      "page-fetch@1": { provider: "w", fallback: [] },
    });
    expect((await runFail(bus.invoke("nope@9", {}))).reason).toBe("unknown");
    expect((await runFail(bus.invoke("page-fetch@1", { url: 42 }))).reason)
      .toBe("bad_input");
  });

  test("valid call validates output and returns it", async () => {
    const bus = busWith({ w: fetchOk }, {
      "page-fetch@1": { provider: "w", fallback: [] },
    });
    const res = await Effect.runPromise(
      bus.invoke("page-fetch@1", { url: "https://x" }),
    );
    expect(res).toEqual({ status: 200, content: "hi", format: "text" });
  });

  test("a provider breaking the contract is a hard bad_output (no failover)", async () => {
    const bad: Active = {
      providers: [{
        capability: "page-fetch@1",
        invoke: async () => ({ nope: 1 }),
      }],
    };
    const bus = busWith(
      { bad, good: fetchOk },
      { "page-fetch@1": { provider: "bad", fallback: ["good"] } },
    );
    expect(
      (await runFail(bus.invoke("page-fetch@1", { url: "https://x" }))).reason,
    ).toBe("bad_output");
  });

  test("retryable failure fails over; non-retryable does not", async () => {
    const flaky: Active = {
      providers: [
        {
          capability: "page-fetch@1",
          invoke: async () => {
            throw new McpError({ message: "down", phase: "connect" }); // retryable
          },
        },
      ],
    };
    const crashy: Active = {
      providers: [
        {
          capability: "page-fetch@1",
          invoke: async () => {
            throw new Error("bug"); // not tagged → hard
          },
        },
      ],
    };
    const failover = busWith({ flaky, good: fetchOk }, {
      "page-fetch@1": { provider: "flaky", fallback: ["good"] },
    });
    const failoverRes = await Effect.runPromise(
      Effect.result(failover.invoke("page-fetch@1", { url: "https://x" })),
    );
    expect(Result.isSuccess(failoverRes)).toBe(true);

    const hard = busWith({ crashy, good: fetchOk }, {
      "page-fetch@1": { provider: "crashy", fallback: ["good"] },
    });
    expect(
      (await runFail(hard.invoke("page-fetch@1", { url: "https://x" }))).reason,
    ).toBe("failed");
  });

  test("cycle and depth are rejected, and errors carry the chain", async () => {
    const bus = busWith({ w: fetchOk }, {
      "page-fetch@1": { provider: "w", fallback: [] },
    });
    const cycle = await runFail(
      bus.invoke("page-fetch@1", { url: "https://x" }, {
        chain: [{ kind: "capability", ref: "page-fetch@1" }],
      }),
    );
    expect(cycle.reason).toBe("cycle");

    const err = await runFail(
      bus.invoke("page-fetch@1", { url: "https://x" }, {
        chain: [
          { kind: "capability", ref: "a@1" },
          { kind: "capability", ref: "b@1" },
          { kind: "capability", ref: "c@1" },
          { kind: "capability", ref: "d@1" },
        ],
      }),
    );
    expect(err.reason).toBe("depth");
    expect(err.message).toContain("capability:a@1");
    expect(err.message).toContain("→");
  });

  test("CapabilityError is a tagged error", () => {
    const e = new CapabilityError({ reason: "failed", detail: "x", chain: [] });
    expect(e._tag).toBe("CapabilityError");
    expect(e.retryable).toBe(false);
  });
});
