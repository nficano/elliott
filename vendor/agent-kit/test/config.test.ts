import { describe, expect, test } from "bun:test";
import {
  envResolver,
  interpolate,
  InterpolationError,
} from "../src/host/config/interpolate.js";
import { deepMerge, validate } from "../src/host/config/load.js";

describe("config (§5)", () => {
  test("deepMerge: later layers override, objects merge, arrays replace", () => {
    const base = { a: { x: 1, y: 2 }, list: [1, 2] };
    const over = { a: { y: 3 }, list: [9] };
    expect(deepMerge(base, over)).toEqual({ a: { x: 1, y: 3 }, list: [9] });
  });

  test("interpolate resolves ${ENV:NAME} and throws on missing", async () => {
    const r = envResolver({ FOO: "bar" });
    expect(await interpolate({ k: "${ENV:FOO}" }, r)).toEqual({ k: "bar" });
    expect(await interpolate({ k: "${FOO}" }, r)).toEqual({ k: "bar" });
    await expect(interpolate({ k: "${ENV:MISSING}" }, r)).rejects
      .toBeInstanceOf(InterpolationError);
  });

  test("VAULT refs require a #field and go to the resolver", async () => {
    const seen: string[] = [];
    const r = {
      env: () => undefined,
      vault: async (path: string, field: string) => {
        seen.push(`${path}#${field}`);
        return "secret-value";
      },
    };
    expect(await interpolate({ k: "${VAULT:secret/services/x#token}" }, r))
      .toEqual({ k: "secret-value" });
    expect(seen).toEqual(["secret/services/x#token"]);
  });

  test("validate rejects a config missing a core section", () => {
    expect(() =>
      validate({
        llm: { base_url: "x", api_key: "y", models: {}, profiles: {} },
      })
    ).toThrow();
  });

  test("validate accepts a minimal valid config and applies defaults", () => {
    const cfg = validate({
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
    });
    expect(cfg.runtime.http.port).toBe(8080);
    expect(cfg.budgets.cold_tokens_max).toBe(6000);
    expect(cfg.store.vectors.dim).toBe(768);
  });
});
