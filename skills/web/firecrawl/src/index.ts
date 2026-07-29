import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  optionalInteger,
  publicUrl,
  request,
  requiredString,
} from "../../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../../src/runtime/types";

const LIMIT_BOUNDS = { min: 1, max: 10, fallback: 5 } as const;

export const register = (context: SkillContext): SkillRegistration => {
  const apiKey = context.settings.firecrawlApiKey;
  return apiKey === undefined
    ? {}
    : { tools: [searchTool(apiKey), scrapeTool(apiKey)] };
};

const searchTool = (apiKey: string): ToolDefinition => ({
  name: "firecrawl_search",
  description: "Search the web and return scraped markdown for the top "
    + "results in one call.",
  inputSchema: objectSchema({
    query: { type: "string" },
    limit: {
      type: "integer",
      minimum: LIMIT_BOUNDS.min,
      maximum: LIMIT_BOUNDS.max,
    },
  }, ["query"]),
  execute: (input) =>
    firecrawl(apiKey, "search", {
      query: requiredString(input, "query"),
      limit: optionalInteger(input, "limit", LIMIT_BOUNDS),
    }),
});

const scrapeTool = (apiKey: string): ToolDefinition => ({
  name: "firecrawl_scrape",
  description: "Scrape a known public URL to clean markdown. Prefer over "
    + "fetch_url when you need readable, boilerplate-stripped content.",
  inputSchema: objectSchema({ url: { type: "string", format: "uri" } }, [
    "url",
  ]),
  execute: (input) => {
    const url = publicUrl(requiredString(input, "url"));
    return firecrawl(apiKey, "scrape", {
      url: url.href,
      formats: ["markdown"],
    });
  },
});

const firecrawl = async (
  apiKey: string,
  operation: "search" | "scrape",
  body: unknown,
): Promise<string> => {
  const response = await request(
    `https://api.firecrawl.dev/v1/${operation}`,
    {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body,
  );
  const payload: unknown = await response.json();
  return JSON.stringify(payload).slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
};
