import type { ResultLink, SearchResult } from "./types";

const RESULT_COUNT = 5;
const RESULT_LINK_MARKER = "class=\"result__a\"";
const RESULT_SNIPPET_MARKER = "class=\"result__snippet\"";

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

const cleanText = (value: string): string =>
  stripActiveHtml(decodeHtml(value))
    .replaceAll(/\s+/g, " ")
    .trim();

const stripActiveHtml = (input: string): string =>
  stripTags(stripElement(stripElement(input, "script"), "style"));

const stripTags = (input: string): string => {
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = input.indexOf("<", cursor);
    if (start === -1) return output + input.slice(cursor);
    const end = input.indexOf(">", start + 1);
    if (end === -1) return output + input.slice(cursor);
    output += `${input.slice(cursor, start)} `;
    cursor = end + 1;
  }
};

const stripElement = (input: string, name: string): string => {
  const close = `</${name}>`;
  let output = input;
  for (;;) {
    const lower = output.toLowerCase();
    const start = lower.indexOf(`<${name}`);
    if (start === -1) return output;
    const end = lower.indexOf(close, start);
    output = end === -1
      ? output.slice(0, start)
      : output.slice(0, start) + output.slice(end + close.length);
  }
};

const decodeHtml = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
