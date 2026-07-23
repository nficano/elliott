import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ToolDef } from "../src/core/agent/types.js";
import type {
  Active,
  IndexedEntry,
  Registrable,
  Registry,
} from "../src/host/registry/types.js";
import {
  bm25Rank,
  buildBm25Index,
  rankBm25,
  rrf,
} from "../src/host/router/bm25.js";
import { RouterCatalog } from "../src/host/router/catalog.js";
import { StaticEmbedder } from "../src/host/router/embed.js";

describe("router ranking (§10.1)", () => {
  const docs = [
    { id: "brave_search", text: "brave search web results current facts news" },
    { id: "browser_open", text: "open url browser session render javascript" },
    { id: "notify", text: "send owner alert notification push" },
  ];

  test("BM25 ranks the on-topic tool first", () => {
    const ranked = bm25Rank("search the web for news", docs);
    expect(ranked[0]!.id).toBe("brave_search");
    expect(rankBm25("search the web for news", buildBm25Index(docs)))
      .toEqual(ranked);
  });

  test("substring fallback covers zero-IDF queries", () => {
    const gh = [
      { id: "github_issue", text: "github issue create" },
      { id: "github_pr", text: "github pull request" },
    ];
    const ranked = bm25Rank("github", gh);
    // every doc contains 'github' (zero IDF) but the fallback still scores them.
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });

  test("RRF fuses two ranked lists", () => {
    const a = [{ id: "x", score: 1 }, { id: "y", score: 0.5 }];
    const b = [{ id: "y", score: 1 }, { id: "x", score: 0.5 }];
    const fused = rrf([a, b]);
    // both appear once at rank0 and once at rank1 → equal fused score
    expect(fused.get("x")).toBeCloseTo(fused.get("y")!, 6);
  });

  test("static embedder: identical text cosine ~1, unrelated < identical", () => {
    const e = new StaticEmbedder();
    const a = e.embed("send an email to the owner");
    const a2 = e.embed("send an email to the owner");
    const b = e.embed("render a javascript page in the browser");
    expect(e.cosine(a, a2)).toBeCloseTo(1, 5);
    expect(e.cosine(a, b)).toBeLessThan(e.cosine(a, a2));
  });
});

describe("router catalog", () => {
  test("indexes write tools so trusted turns can use MCP servers", async () => {
    const writeTool: ToolDef = {
      name: "home_assistant_GetLiveContext",
      description: "Read current Home Assistant context",
      parameters: { type: "object", properties: {} },
      execute: () => Effect.succeed("ok"),
      meta: {
        componentId: "home-assistant",
        bundle: "home",
        core: false,
        write: true,
      },
    };
    const active: Active = { writeTools: [writeTool] };
    const registrable: Registrable = {
      manifest: {
        id: "home-assistant",
        kind: "mcp",
        version: "0.1.0",
        configSchema: Schema.Unknown,
        bundle: "home",
        trust: "write",
      },
      activate: async () => active,
    };
    const indexed: IndexedEntry = {
      registrable,
      config: {},
      enabled: true,
      secrets: {},
    };
    const registry: Registry = {
      index() {},
      activate: async () => active,
      activateBundle: async () => [active],
      get: () => indexed,
      all: () => [indexed],
      providersOf: () => [],
      promptFragments: () => [],
      inventory: () => [],
      stop: async () => {},
    };
    const catalog = new RouterCatalog({
      registry,
      embedder: new StaticEmbedder(),
      bundleDescriptions: { home: "home assistant" },
      bundleOrder: ["home"],
      coreTools: () => [],
      contextWindowFor: () => 200_000,
      disclosureCutoffTokens: 20_000,
      maxBundles: 3,
    });

    expect((await catalog.ensure()).has(writeTool.name)).toBe(true);
  });
});
