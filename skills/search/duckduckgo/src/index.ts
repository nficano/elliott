import {
  objectSchema,
  request,
  requiredString,
} from "../../../../src/runtime/skills/http";
import type { SkillRegistration } from "../../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../../src/runtime/types";
import { parseDuckDuckGoResults } from "./parser";

const USER_AGENT = "Mozilla/5.0 (compatible; Elliott/1.0)";

export { parseDuckDuckGoResults } from "./parser";

export const register = (): SkillRegistration => ({
  tools: [searchTool()],
});

const searchTool = (): ToolDefinition => ({
  name: "duckduckgo_search",
  description: "Search the public web without an API key.",
  inputSchema: objectSchema({ query: { type: "string" } }, ["query"]),
  execute: async (input) => {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", requiredString(input, "query"));
    const response = await request(url, { "user-agent": USER_AGENT });
    return JSON.stringify(parseDuckDuckGoResults(await response.text()));
  },
});
