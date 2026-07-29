import { isJsonRecord, recordArray } from "../../../../src/providers/http";
import {
  objectSchema,
  optionalInteger,
  request,
  requiredString,
  stringValue,
} from "../../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../../src/runtime/types";

const COUNT_BOUNDS = { min: 1, max: 20, fallback: 5 } as const;

export const register = (context: SkillContext): SkillRegistration => {
  const apiKey = context.settings.braveApiKey;
  return apiKey === undefined ? {} : { tools: [searchTool(apiKey)] };
};

const searchTool = (apiKey: string): ToolDefinition => ({
  name: "brave_search",
  description: "Search the public web using Brave Search. Use for current "
    + "facts, news, or finding pages to read. Returns title/url/snippet "
    + "for the top results.",
  inputSchema: objectSchema({
    query: { type: "string" },
    count: {
      type: "integer",
      minimum: COUNT_BOUNDS.min,
      maximum: COUNT_BOUNDS.max,
    },
  }, ["query"]),
  execute: async (input) => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", requiredString(input, "query"));
    url.searchParams.set(
      "count",
      String(optionalInteger(input, "count", COUNT_BOUNDS)),
    );
    const response = await request(url, {
      accept: "application/json",
      "x-subscription-token": apiKey,
    });
    const payload: unknown = await response.json();
    if (!isJsonRecord(payload) || !isJsonRecord(payload["web"])) {
      throw new Error("Brave returned invalid JSON");
    }
    return JSON.stringify(
      recordArray(payload["web"], "results").map((item) => ({
        title: stringValue(item["title"]),
        url: stringValue(item["url"]),
        snippet: stringValue(item["description"]),
      })),
    );
  },
});
