import { isJsonRecord, recordArray } from "../../../src/providers/http";
import {
  objectSchema,
  request,
  requiredString,
} from "../../../src/runtime/skills/http";
import type { SkillRegistration } from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";

const RESULT_COUNT = 5;

export const register = (): SkillRegistration => ({
  tools: [searchTool()],
});

const searchTool = (): ToolDefinition => ({
  name: "duckduckgo_search",
  description: "Search the public web without an API key.",
  inputSchema: objectSchema({ query: { type: "string" } }, ["query"]),
  execute: async (input) => {
    const query = requiredString(input, "query");
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const response = await request(url);
    const payload: unknown = await response.json();
    if (!isJsonRecord(payload)) {
      throw new Error("DuckDuckGo returned invalid JSON");
    }
    return JSON.stringify(results(payload));
  },
});

const results = (
  payload: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, string>>[] => {
  const heading = payload["Heading"];
  const abstractUrl = payload["AbstractURL"];
  const direct = typeof payload["AbstractText"] === "string"
      && payload["AbstractText"].length > 0
    ? [{
      title: typeof heading === "string" ? heading : "DuckDuckGo",
      url: typeof abstractUrl === "string" ? abstractUrl : "",
      snippet: payload["AbstractText"],
    }]
    : [];
  const related = recordArray(payload, "RelatedTopics").flatMap((item) => {
    const text = item["Text"];
    const url = item["FirstURL"];
    return typeof text === "string" && typeof url === "string"
      ? [{ title: text.split(" - ", 1)[0] ?? text, url, snippet: text }]
      : [];
  });
  return [...direct, ...related].slice(0, RESULT_COUNT);
};
