import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { BrowserClient } from "./browser/client.js";
import { ConfigSchema } from "./schema.js";

/**
 * The agent-browser skill (§18): JS-rendered reading via the headless-Chrome
 * daemon container (browserless). Two stateless `web`-bundle read tools —
 * `browser_render` (full page after JS) and `browser_scrape` (targeted by CSS
 * selector). Prefer over `webpage_fetch` only when a page needs JS to render.
 */
const manifest: Manifest<typeof ConfigSchema.Type> = {
  id: "browser",
  kind: "skill",
  version: "0.2.0",
  configSchema: ConfigSchema,
  bundle: "web",
  trust: "read",
  defaultTier: "standard",
  capabilities: ["reads:web"],
  contracts: { tools: ["browser_render", "browser_scrape"] },
};
const RENDERED_TEXT_MAX_CHARS = 8000;

export function browserSkill(): Registrable<typeof ConfigSchema.Type> {
  return {
    manifest,
    async activate(ctx) {
      const client = new BrowserClient({
        daemonUrl: ctx.config.daemon_url,
        token: ctx.config.token,
        allowedDomains: ctx.config.allowed_domains,
        maxOutput: ctx.config.max_output,
      });
      return { tools: makeTools(client) };
    },
  };
}

function makeTools(client: BrowserClient): ToolDef[] {
  const meta = {
    componentId: "browser",
    bundle: "web",
    core: false,
    write: false,
  };
  return [
    define({
      name: "browser_render",
      description:
        "Load a URL in a real headless browser (JS executed) and return its rendered text. "
        + "Use only when webpage_fetch/firecrawl fail because the page needs JavaScript to show "
        + "content (SPAs, infinite-scroll, JS-gated). Slower than a plain fetch.",
      schema: Schema.Struct({ url: Schema.String }),
      meta,
      run: async (a) => {
        const res = await client.content(a.url);
        return res.ok
          ? stripHtml(res.data ?? "")
          : JSON.stringify({ error: res.error });
      },
    }),
    define({
      name: "browser_scrape",
      description:
        "Render a URL and extract text for specific CSS selectors (e.g. 'h1', '.price', "
        + "'article p'). Use when you need particular elements from a JS-rendered page rather "
        + "than the whole thing.",
      schema: Schema.Struct({
        url: Schema.String,
        selectors: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      }),
      meta,
      run: async (a) => {
        const res = await client.scrape(a.url, a.selectors);
        return res.ok
          ? JSON.stringify(res.data)
          : JSON.stringify({ error: res.error });
      },
    }),
  ];
}

function stripHtml(html: string): string {
  return stripTags(
    removeElementBlocks(removeElementBlocks(html, "script"), "style"),
  )
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, RENDERED_TEXT_MAX_CHARS);
}

function stripTags(html: string): string {
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = html.indexOf("<", cursor);
    if (start === -1) return output + html.slice(cursor);
    const end = html.indexOf(">", start + 1);
    if (end === -1) return output + html.slice(cursor);
    output += `${html.slice(cursor, start)} `;
    cursor = end + 1;
  }
}

function removeElementBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = lower.indexOf(open, cursor);
    if (start === -1) return output + html.slice(cursor);
    const openEnd = lower.indexOf(">", start + open.length);
    const end = openEnd === -1 ? -1 : lower.indexOf(close, openEnd + 1);
    if (end === -1) return output + html.slice(cursor);
    output += `${html.slice(cursor, start)} `;
    cursor = end + close.length;
  }
}
