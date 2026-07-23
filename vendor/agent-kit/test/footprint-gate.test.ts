import { describe, expect, test } from "bun:test";
import { validate } from "../src/host/config/load.js";
import { webPack } from "../src/skills/web/index.js";
import { lintSchema, runFootprintGate } from "../src/testkit/footprint-gate.js";

const baseConfig = (coldMax: number) =>
  validate({
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
    budgets: { cold_tokens_max: coldMax },
    skills: {
      brave: { enabled: true, api_key: "x" },
      firecrawl: { enabled: true, api_key: "x" },
      webpage: { enabled: true },
      browser: { enabled: true, daemon_url: "http://agent-browser:9000" },
    },
  });

describe("static footprint gate (§11.3)", () => {
  test("passes with a generous budget and reports per-bundle cold tokens", async () => {
    const report = await runFootprintGate({
      config: baseConfig(50_000),
      registrables: webPack(),
    });
    expect(report.pass).toBe(true);
    const web = report.perBundle.find((b) => b.bundle === "web");
    expect(web).toBeDefined();
    expect(web!.tools).toBeGreaterThan(0);
    expect(web!.coldTokens).toBeGreaterThan(0);
  });

  test("fails when the web bundle blows a tiny cold-token budget", async () => {
    const report = await runFootprintGate({
      config: baseConfig(50),
      registrables: webPack(),
    });
    expect(report.pass).toBe(false);
    expect(report.budgetViolations.length).toBeGreaterThan(0);
  });

  test("schema lint flags a non-object root", () => {
    expect(lintSchema("bad", { type: "string" }).length).toBeGreaterThan(0);
    expect(lintSchema("ok", { type: "object", properties: {} }).length).toBe(0);
  });
});
