import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import type { ProviderState } from "../../src/model/provider/types";
import { RouteTableStore } from "../../src/model/routetable";
import type { RouteTableKey } from "../../src/model/routing/types";
import type {
  ModelGenerateRequest,
  ModelStreamEvent,
} from "../../src/model/types";
import { LiteLlmProvider } from "../../src/providers/litellm/index";
import { OllamaProvider } from "../../src/providers/ollama/index";
import {
  makeCatalogEntry,
  makeResidencyGrant,
  makeRouteContext,
} from "../helpers";

const modelRequest: ModelGenerateRequest = {
  invocation: "invocation",
  modelId: "model",
  messages: [{ role: "user", content: "hello" }],
  tools: [{
    name: "search",
    description: "Search",
    inputSchema: { type: "object" },
  }],
  maxOutputTokens: 100,
  temperature: 0,
  metadata: {},
};

const requestUrl = (input: string | URL | Request): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input.toString());

const collect = async (
  stream: AsyncIterable<ModelStreamEvent>,
): Promise<readonly ModelStreamEvent[]> => Array.fromAsync(stream);

describe("M4 provider adapters", () => {
  it("translates LiteLLM calls and returns tool requests without executing them", async () => {
    const paths: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = requestUrl(input);
      paths.push(url.pathname);
      if (url.pathname === "/v1/chat/completions") {
        return Response.json({
          choices: [{
            message: {
              content: "answer",
              tool_calls: [{ id: "call", function: { name: "search" } }],
            },
          }],
          usage: { prompt_tokens: 4 },
        });
      }
      if (url.pathname === "/v1/embeddings") {
        return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
      }
      return new Response(undefined, { status: 200 });
    };
    const catalog = [makeCatalogEntry()];
    const provider = new LiteLlmProvider({
      baseUrl: "https://litellm.local",
      catalog,
      fetcher,
    });
    const state: ProviderState = {
      id: "litellm",
      protocol: provider,
      residency: makeResidencyGrant("litellm"),
      catalog,
      catalogDigest: digest("litellm-catalog"),
      health: { healthy: true, reportedAtMs: 0, cadenceMs: 1000 },
    };
    const key: RouteTableKey = {
      profile: "fast",
      effectiveClassification: "internal",
      requiredCapabilities: ["text"],
    };
    expect(
      new RouteTableStore().resolve(key, makeRouteContext(state)).candidates[0]
        ?.provider,
    ).toBe("litellm");
    const events = await collect(provider.generate(modelRequest));
    expect(events.map((event) => event.type)).toEqual([
      "text",
      "tool-call",
      "usage",
      "done",
    ]);
    expect(await provider.embed({ modelId: "model", inputs: ["one"] }))
      .toEqual({ embeddings: [[0.1, 0.2]] });
    expect((await provider.health()).healthy).toBe(true);
    expect(await provider.catalog()).toEqual(catalog);
    expect(paths).toEqual([
      "/v1/chat/completions",
      "/v1/embeddings",
      "/health",
    ]);
  });

  it("uses Ollama as a verified local confidential route", async () => {
    const fetcher: typeof fetch = async (input) => {
      const path = requestUrl(input).pathname;
      if (path === "/api/chat") {
        return Response.json({
          message: { content: "local", tool_calls: [] },
          prompt_eval_count: 2,
        });
      }
      if (path === "/api/embed") {
        return Response.json({ embeddings: [[0.3, 0.4]] });
      }
      return new Response(undefined, { status: 200 });
    };
    const catalog = [makeCatalogEntry("model", "local", ["text"])];
    const protocol = new OllamaProvider({
      baseUrl: "https://ollama.local",
      catalog,
      fetcher,
    });
    const state: ProviderState = {
      id: "ollama",
      protocol,
      residency: makeResidencyGrant("ollama", "none", "restricted"),
      catalog,
      catalogDigest: digest("ollama-catalog"),
      health: { healthy: true, reportedAtMs: 0, cadenceMs: 1000 },
    };
    const key: RouteTableKey = {
      profile: "fast",
      effectiveClassification: "confidential",
      requiredCapabilities: ["text"],
    };
    expect(
      new RouteTableStore().resolve(key, makeRouteContext(state)).candidates[0]
        ?.provider,
    ).toBe("ollama");
    expect((await collect(protocol.generate(modelRequest)))[0]?.payload).toBe(
      "local",
    );
    expect(await protocol.embed({ modelId: "model", inputs: ["one"] }))
      .toEqual({ embeddings: [[0.3, 0.4]] });
  });
});
