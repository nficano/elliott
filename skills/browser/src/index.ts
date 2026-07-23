import { isJsonRecord, recordArray } from "../../../src/providers/http";
import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  publicUrl,
  request,
  requiredString,
  stripActiveHtml,
} from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  BrowserSettings,
  ToolDefinition,
} from "../../../src/runtime/types";

export const register = (context: SkillContext): SkillRegistration => ({
  tools: [
    renderTool(context.settings.browser),
    scrapeTool(context.settings.browser),
  ],
});

const renderTool = (settings: BrowserSettings): ToolDefinition => ({
  name: "browser_render",
  description: "Load a URL in isolated headless Chromium (JavaScript "
    + "executed) and return its rendered text. Use only when fetch_url or "
    + "firecrawl fail because the page needs JavaScript. Slower than a "
    + "plain fetch.",
  inputSchema: objectSchema({ url: { type: "string", format: "uri" } }, [
    "url",
  ]),
  execute: async (input) => {
    const target = allowedTarget(input, settings);
    const response = await daemonRequest(settings, "/content", {
      url: target.href,
    });
    const html = await response.text();
    return stripActiveHtml(html).slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
  },
});

const scrapeTool = (settings: BrowserSettings): ToolDefinition => ({
  name: "browser_scrape",
  description: "Render a URL in isolated Chromium and extract text for "
    + "specific CSS selectors (e.g. 'h1', '.price', 'article p'). Use when "
    + "you need particular elements from a JavaScript-rendered page.",
  inputSchema: objectSchema({
    url: { type: "string", format: "uri" },
    selectors: { type: "array", items: { type: "string" }, minItems: 1 },
  }, ["url", "selectors"]),
  execute: async (input) => {
    const target = allowedTarget(input, settings);
    const selectors = requiredSelectors(input);
    const response = await daemonRequest(settings, "/scrape", {
      url: target.href,
      elements: selectors.map((selector) => ({ selector })),
    });
    const payload: unknown = await response.json();
    if (!isJsonRecord(payload)) {
      throw new Error("agent-browser returned an invalid payload");
    }
    return JSON.stringify(scrapeHits(payload))
      .slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
  },
});

const scrapeHits = (
  payload: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, string>>[] =>
  recordArray(payload, "data").flatMap((entry) => {
    const selector = typeof entry["selector"] === "string"
      ? entry["selector"]
      : "";
    return recordArray(entry, "results").map((result) => ({
      selector,
      text: typeof result["text"] === "string" ? result["text"].trim() : "",
    }));
  });

const allowedTarget = (input: unknown, settings: BrowserSettings): URL => {
  const target = publicUrl(requiredString(input, "url"));
  if (settings.allowedDomains.length === 0) return target;
  const accepted = settings.allowedDomains.some((domain) =>
    target.hostname === domain || target.hostname.endsWith(`.${domain}`)
  );
  if (!accepted) {
    throw new Error(`Browser domain is not granted: ${target.hostname}`);
  }
  return target;
};

const requiredSelectors = (input: unknown): readonly string[] => {
  if (!isJsonRecord(input) || !Array.isArray(input["selectors"])) {
    throw new TypeError("Tool argument selectors must be an array");
  }
  const selectors = input["selectors"].filter((item): item is string =>
    typeof item === "string" && item.length > 0
  );
  if (selectors.length === 0) {
    throw new TypeError("Tool argument selectors must name at least one");
  }
  return selectors;
};

const daemonRequest = (
  settings: BrowserSettings,
  path: string,
  body: unknown,
): Promise<Response> => {
  const endpoint = new URL(path, settings.baseUrl);
  endpoint.searchParams.set("token", settings.token);
  return request(endpoint, { "content-type": "application/json" }, body);
};
