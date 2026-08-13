import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  requestPublicUrl,
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
    // requestPublicUrl validates the destination and connects to it in one
    // step, pinned to the exact address it validated — see its doc comment
    // in http.ts for why a separate publicUrl()-then-fetch() would be
    // vulnerable to DNS rebinding.
    const response = await requestPublicUrl(requiredString(input, "url"));
    const text = await response.text();
    return JSON.stringify({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: stripActiveHtml(text).slice(0, MAX_TOOL_OUTPUT_CHARACTERS),
    });
  },
});
