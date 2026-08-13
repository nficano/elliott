import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  publicUrl,
  request,
  requiredString,
  stripActiveHtml,
} from "../../../src/runtime/skills/http";
import type { SkillRegistration } from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";

export const register = (): SkillRegistration => ({
  tools: [fetchTool()],
});

const fetchTool = (): ToolDefinition => ({
  name: "fetch_url",
  description: "Fetch text from a public HTTP or HTTPS URL (HTML tags "
    + "stripped). Cheapest reader; use for simple static pages.",
  inputSchema: objectSchema({ url: { type: "string", format: "uri" } }, [
    "url",
  ]),
  execute: async (input) => {
    const url = await publicUrl(requiredString(input, "url"));
    const response = await request(url);
    const text = await response.text();
    return JSON.stringify({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: stripActiveHtml(text).slice(0, MAX_TOOL_OUTPUT_CHARACTERS),
    });
  },
});
