import { describe, expect, it } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { BUNDLED_CATALOG, loadBundledPackages } from "../../src/catalog/index";

const root = path.resolve(import.meta.dir, "../..");

const IMPLEMENTED = [
  "browser",
  "cloudflared",
  "evaluator-agent-benchmarks",
  "evaluator-darwinian",
  "evaluator-dspy",
  "fetch",
  "files",
  "gateway-bluebubbles",
  "gateway-email",
  "gateway-gmail",
  "gateway-home-assistant",
  "gateway-slack",
  "gateway-webhook",
  "mcp-client",
  "news-brief",
  "pakman-latest-episode",
  "pihole",
  "scheduler",
  "search-brave",
  "search-duckduckgo",
  "ssh",
  "telemetry-map",
  "terminal",
  "traefik",
  "web-firecrawl",
  "web-parallel",
  "youtube-dvr",
];

describe("Elliott bundled component packages", () => {
  it("ships a complete package for every TDD catalog entry", async () => {
    const packages = await loadBundledPackages(root);
    const packageNames = packages
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    const catalogNames = BUNDLED_CATALOG
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    expect(packageNames).toEqual(catalogNames);
    expect(packageNames).toContain("gateway-slack");
    expect(packageNames).toContain("gateway-home-assistant");
    expect(packageNames).toContain("mcp-client");
    for (const item of packages) {
      expect(item.profile.length).toBeGreaterThan(0);
      expect(item.protocols.length).toBeGreaterThan(0);
      await access(path.join(item.directory, "component.yaml"));
      await access(path.join(item.directory, item.document));
    }
  });

  it("bundles an executable module for every implemented skill", async () => {
    const packages = await loadBundledPackages(root);
    const implemented = packages.filter(
      (item) => item.entrypoint !== undefined,
    );
    const names = implemented
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    expect(names).toEqual(IMPLEMENTED);
    for (const item of implemented) {
      expect(item.exports.length).toBeGreaterThan(0);
      const module: unknown = await import(item.entrypoint!);
      const register = (module as { register?: unknown; }).register;
      expect(typeof register).toBe("function");
    }
  });

  it("runs without a vendored secondary agent framework", async () => {
    const files = [
      "package.json",
      "Dockerfile",
      "agents/elliott.yaml",
      "src/runtime/main.ts",
      "src/runtime/config.ts",
    ];
    const contents = await Promise.all(
      files.map((file) => readFile(path.join(root, file), "utf8")),
    );
    expect(contents.join("\n")).not.toMatch(/agent[-_]kit/i);
    await expect(access(path.join(root, "vendor/agent-kit"))).rejects.toThrow();
  });
});
