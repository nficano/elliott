import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import { ToolError } from "../../core/errors.js";
import { pageFetch1, webSearch1 } from "../../host/capabilities/contracts.js";
import type { ProviderImpl } from "../../host/capabilities/types.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import {
  FirecrawlConfig,
  FirecrawlScrapeResponseSchema,
  FirecrawlSearchResponseSchema,
} from "./schema.js";
import type { Headers, SearchResult } from "./types.js";

const MAX_SEARCH_RESULTS = 10;
const DEFAULT_SEARCH_RESULTS = 5;
const SEARCH_URL = "https://api.firecrawl.dev/v1/search";
const SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const FIRECRAWL_META = {
  componentId: "firecrawl",
  bundle: "web",
  core: false,
  write: false,
};

const manifest: Manifest<typeof FirecrawlConfig.Type> = {
  id: "firecrawl",
  kind: "skill",
  version: "0.1.0",
  configSchema: FirecrawlConfig,
  bundle: "web",
  trust: "read",
  defaultTier: "standard",
  capabilities: ["reads:web"],
  contracts: { tools: ["firecrawl_scrape", "firecrawl_search"] },
  provides: [
    { capability: "web-search@1" },
    { capability: "page-fetch@1" },
  ],
  secrets: [{ name: "api_key", description: "Firecrawl API key" }],
};

export function firecrawlSkill(): Registrable<typeof FirecrawlConfig.Type> {
  return {
    manifest,
    async activate(ctx) {
      const headers = {
        authorization: `Bearer ${ctx.secrets.api_key!}`,
        "content-type": "application/json",
      };
      const scrape = makeScrape(headers);
      return {
        tools: [makeScrapeTool(scrape), makeSearchTool(headers)],
        providers: makeProviders(headers, scrape),
      };
    },
  };
}

function makeScrape(headers: Headers) {
  return async (url: string) => {
    const { response, payload } = await Effect.runPromise(
      requestFirecrawlScrape(headers, url),
    );
    return {
      status: response.status,
      content: payload.data?.markdown ?? "",
      format: "markdown",
    };
  };
}

const requestFirecrawlScrape = Effect.fn("skillsWeb.firecrawl.scrape")(
  function*(headers: Headers, url: string) {
    const response = yield* requestFirecrawl(SCRAPE_URL, headers, {
      url,
      formats: ["markdown"],
    });
    if (!response.ok) {
      return yield* Effect.fail(firecrawlError(`HTTP ${response.status}`));
    }
    const payload = yield* decodeResponse(
      response,
      FirecrawlScrapeResponseSchema,
    );
    return { response, payload };
  },
);

function makeScrapeTool(scrape: ReturnType<typeof makeScrape>): ToolDef {
  return define({
    name: "firecrawl_scrape",
    description:
      "Scrape a single URL to clean markdown. Prefer over webpage when you need readable, "
      + "boilerplate-stripped content from a known URL.",
    schema: Schema.Struct({ url: Schema.String }),
    meta: FIRECRAWL_META,
    run: async (args) => {
      try {
        const output = await scrape(args.url);
        return output.content || JSON.stringify({ error: "no content" });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

function makeSearchTool(headers: Headers): ToolDef {
  return define({
    name: "firecrawl_search",
    description:
      "Search the web and return scraped markdown for the top results in one call.",
    schema: Schema.Struct({
      query: Schema.String,
      limit: Schema.optional(
        Schema.Number.check(
          Schema.isInt(),
          Schema.isLessThanOrEqualTo(MAX_SEARCH_RESULTS),
        ),
      ),
    }),
    meta: FIRECRAWL_META,
    run: async (args) => {
      const result = await firecrawlSearch(
        headers,
        args.query,
        args.limit ?? DEFAULT_SEARCH_RESULTS,
      );
      return result.ok
        ? JSON.stringify(result.payload)
        : JSON.stringify({ error: `firecrawl ${result.status}` });
    },
  });
}

function makeProviders(
  headers: Headers,
  scrape: ReturnType<typeof makeScrape>,
): ProviderImpl[] {
  return [
    {
      capability: "web-search@1",
      invoke: async (input) => {
        const args = await Effect.runPromise(
          Schema.decodeUnknownEffect(webSearch1.input)(input),
        );
        const result = await firecrawlSearch(
          headers,
          args.query,
          args.count ?? DEFAULT_SEARCH_RESULTS,
        );
        if (!result.ok) throw firecrawlError(`HTTP ${result.status}`);
        return searchHits(result.payload);
      },
    },
    {
      capability: "page-fetch@1",
      invoke: async (input) => {
        const args = await Effect.runPromise(
          Schema.decodeUnknownEffect(pageFetch1.input)(input),
        );
        const output = await scrape(args.url);
        return args.maxChars
          ? { ...output, content: output.content.slice(0, args.maxChars) }
          : output;
      },
    },
  ];
}

function firecrawlSearch(
  headers: Headers,
  query: string,
  limit: number,
): Promise<SearchResult> {
  return Effect.runPromise(requestFirecrawlSearch(headers, query, limit));
}

const requestFirecrawlSearch = Effect.fn("skillsWeb.firecrawl.search")(
  function*(headers: Headers, query: string, limit: number) {
    const response = yield* requestFirecrawl(SEARCH_URL, headers, {
      query,
      limit,
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      } satisfies SearchResult;
    }
    const payload = yield* decodeResponse(
      response,
      FirecrawlSearchResponseSchema,
    );
    return {
      ok: true,
      status: response.status,
      payload,
    } satisfies SearchResult;
  },
);

const requestFirecrawl = Effect.fn("skillsWeb.firecrawl.request")(
  function*(url: string, headers: Headers, body: unknown) {
    return yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      catch: (cause) => firecrawlError("request failed", cause),
    });
  },
);

function decodeResponse<T>(
  response: Response,
  schema: Schema.Decoder<T>,
): Effect.Effect<T, ToolError> {
  return Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => firecrawlError("response read failed", cause),
  }).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text)
    ),
    Effect.mapError((cause) =>
      cause instanceof ToolError
        ? cause
        : firecrawlError("invalid response payload", cause)
    ),
  );
}

function searchHits(json: typeof FirecrawlSearchResponseSchema.Type) {
  return {
    hits: (json.data ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      snippet: result.description ?? "",
    })),
  };
}

function firecrawlError(message: string, cause?: unknown): ToolError {
  return new ToolError({
    message: `firecrawl ${message}`,
    cause,
  });
}
