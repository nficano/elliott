import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import { ToolError } from "../../core/errors.js";
import { webSearch1 } from "../../host/capabilities/contracts.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { BraveConfig, BraveSearchResponseSchema } from "./schema.js";
import type { BraveHitOut } from "./types.js";

const MAX_SEARCH_RESULTS = 20;
const DEFAULT_SEARCH_RESULTS = 5;

const manifest: Manifest<typeof BraveConfig.Type> = {
  id: "brave",
  kind: "skill",
  version: "0.1.0",
  configSchema: BraveConfig,
  bundle: "web",
  trust: "read",
  defaultTier: "standard",
  capabilities: ["reads:web"],
  contracts: { tools: ["brave_search"] },
  provides: [{ capability: "web-search@1" }],
  secrets: [{
    name: "api_key",
    description: "Brave Search subscription token",
  }],
};

export function braveSkill(): Registrable<typeof BraveConfig.Type> {
  return {
    manifest,
    async activate(ctx) {
      const search = makeBraveSearch(ctx.secrets.api_key!);
      return {
        tools: [makeBraveTool(search)],
        providers: [{
          capability: "web-search@1",
          invoke: async (input) => {
            const args = await Effect.runPromise(
              Schema.decodeUnknownEffect(webSearch1.input)(input),
            );
            return search(args.query, args.count ?? DEFAULT_SEARCH_RESULTS);
          },
        }],
      };
    },
  };
}

function makeBraveSearch(apiKey: string) {
  return async (
    query: string,
    count: number,
  ): Promise<{ hits: BraveHitOut[]; }> => {
    const json = await Effect.runPromise(
      requestBrave(apiKey, query, count),
    );
    return {
      hits: (json.web?.results ?? []).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.description,
      })),
    };
  };
}

const requestBrave = Effect.fn("skillsWeb.brave.search")(
  function*(apiKey: string, query: string, count: number) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: {
            accept: "application/json",
            "x-subscription-token": apiKey,
          },
        }),
      catch: (cause) => braveError("request failed", cause),
    });
    if (!response.ok) {
      return yield* Effect.fail(braveError(`HTTP ${response.status}`));
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => braveError("response read failed", cause),
    });
    return yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(BraveSearchResponseSchema),
    )(text).pipe(
      Effect.mapError((cause) => braveError("invalid response payload", cause)),
    );
  },
);

function makeBraveTool(
  search: ReturnType<typeof makeBraveSearch>,
): ToolDef {
  return define({
    name: "brave_search",
    description:
      "Web search via Brave. Use for current facts, news, or finding pages to scrape. Returns "
      + "title/url/snippet for the top results. Prefer over browser for simple lookups.",
    schema: Schema.Struct({
      query: Schema.String,
      count: Schema.optional(
        Schema.Number.check(
          Schema.isInt(),
          Schema.isLessThanOrEqualTo(MAX_SEARCH_RESULTS),
        ),
      ),
    }),
    meta: {
      componentId: "brave",
      bundle: "web",
      core: false,
      write: false,
    },
    run: async (args) => {
      try {
        const result = await search(
          args.query,
          args.count ?? DEFAULT_SEARCH_RESULTS,
        );
        return JSON.stringify(result.hits);
      } catch (error) {
        return JSON.stringify({ error: formatUnknownError(error) });
      }
    },
  });
}

function braveError(message: string, cause?: unknown): ToolError {
  return new ToolError({
    message: `brave ${message}`,
    ...(cause !== undefined && { cause }),
  });
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
