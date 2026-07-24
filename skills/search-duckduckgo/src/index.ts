import {
  objectSchema,
  request,
  requiredString,
  stripActiveHtml,
} from "../../../src/runtime/skills/http";
import type { SkillRegistration } from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";
import type { ResultLink, SearchResult } from "./types";

const RESULT_COUNT = 5;
const RESULT_LINK_MARKER = "class=\"result__a\"";
const RESULT_SNIPPET_MARKER = "class=\"result__snippet\"";
const USER_AGENT = "Mozilla/5.0 (compatible; Elliott/1.0)";

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

export const parseDuckDuckGoResults = (
  html: string,
): readonly SearchResult[] => {
  const output: SearchResult[] = [];
  let cursor = 0;
  while (output.length < RESULT_COUNT) {
    const linkMarker = html.indexOf(RESULT_LINK_MARKER, cursor);
    if (linkMarker === -1) break;
    const link = resultLink(html, linkMarker);
    if (link === undefined) break;
    const nextLink = html.indexOf(RESULT_LINK_MARKER, link.close);
    const snippetMarker = html.indexOf(RESULT_SNIPPET_MARKER, link.close);
    const snippet = snippetMarker !== -1
        && (nextLink === -1 || snippetMarker < nextLink)
      ? elementText(html, snippetMarker)
      : "";
    const target = resultUrl(link.href);
    if (link.title.length > 0 && target.length > 0) {
      output.push({ title: link.title, url: target, snippet });
    }
    cursor = link.close + "</a>".length;
  }
  return output;
};

const resultLink = (
  html: string,
  marker: number,
): ResultLink | undefined => {
  const open = html.lastIndexOf("<a", marker);
  const body = html.indexOf(">", marker);
  const close = html.indexOf("</a>", body);
  if (open === -1 || body === -1 || close === -1) return undefined;
  return {
    close,
    href: attribute(html.slice(open, body), "href"),
    title: cleanText(html.slice(body + 1, close)),
  };
};

const attribute = (tag: string, name: string): string => {
  const marker = `${name}="`;
  const start = tag.indexOf(marker);
  if (start === -1) return "";
  const valueStart = start + marker.length;
  const end = tag.indexOf("\"", valueStart);
  return end === -1 ? "" : decodeHtml(tag.slice(valueStart, end));
};

const elementText = (html: string, marker: number): string => {
  const body = html.indexOf(">", marker);
  if (body === -1) return "";
  const anchorClose = html.indexOf("</a>", body);
  const divClose = html.indexOf("</div>", body);
  const close = firstPositive(anchorClose, divClose);
  return close === -1 ? "" : cleanText(html.slice(body + 1, close));
};

const firstPositive = (left: number, right: number): number => {
  if (left === -1) return right;
  if (right === -1) return left;
  return Math.min(left, right);
};

const resultUrl = (href: string): string => {
  if (href.length === 0) return "";
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    if (
      parsed.hostname.endsWith("duckduckgo.com")
      && parsed.pathname === "/l/"
    ) {
      return parsed.searchParams.get("uddg") ?? "";
    }
    return parsed.href;
  } catch {
    return "";
  }
};

const cleanText = (value: string): string => stripActiveHtml(decodeHtml(value));

const decodeHtml = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
