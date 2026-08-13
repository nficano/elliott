import { isJsonRecord, recordArray } from "../../../src/providers/http";
import {
  objectSchema,
  optionalInteger,
  request,
  requiredString,
  stringValue,
} from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";

const RESULT_BOUNDS = { min: 1, max: 10, fallback: 5 } as const;
const MAX_CHARS_PER_RESULT = 2000;

export const register = (context: SkillContext): SkillRegistration => {
  const apiKey = context.settings.parallelApiKey;
  return apiKey === undefined ? {} : { tools: [searchTool(apiKey)] };
};

const searchTool = (apiKey: string): ToolDefinition => ({
  name: "parallel_search",
  description: "Search the web with Parallel and return extended excerpts "
    + "from the top results. Use when a query needs more source text than "
    + "a title/snippet search provides.",
  inputSchema: objectSchema({
    objective: { type: "string" },
    max_results: {
      type: "integer",
      minimum: RESULT_BOUNDS.min,
      maximum: RESULT_BOUNDS.max,
    },
  }, ["objective"]),
  execute: async (input) => {
    const response = await request(
      "https://api.parallel.ai/v1beta/search",
      { "x-api-key": apiKey, "content-type": "application/json" },
      {
        objective: requiredString(input, "objective"),
        processor: "base",
        max_results: optionalInteger(input, "max_results", RESULT_BOUNDS),
        max_chars_per_result: MAX_CHARS_PER_RESULT,
      },
    );
    const payload: unknown = await response.json();
    if (!isJsonRecord(payload)) {
      throw new Error("Parallel returned invalid JSON");
    }
    return JSON.stringify(
      recordArray(payload, "results").map((item) => ({
        title: stringValue(item["title"]),
        url: stringValue(item["url"]),
        excerpts: Array.isArray(item["excerpts"])
          ? item["excerpts"].filter((entry): entry is string =>
            typeof entry === "string"
          )
          : [],
      })),
    );
  },
});
