import type { Story } from "./types";

const OPENER = /<(item|entry)[\s>]/gi;

export const parseFeed = (
  xml: string,
  feedName: string,
): readonly Story[] =>
  itemBlocks(xml).flatMap((block) => feedStory(block, feedName));

const itemBlocks = (xml: string): readonly string[] => {
  const blocks: string[] = [];
  OPENER.lastIndex = 0;
  for (;;) {
    const match = OPENER.exec(xml);
    if (match === null) break;
    const tag = (match[1] ?? "item").toLowerCase();
    const closeToken = `</${tag}>`;
    const end = xml.indexOf(closeToken, OPENER.lastIndex);
    if (end === -1) break;
    blocks.push(xml.slice(match.index, end));
    OPENER.lastIndex = end + closeToken.length;
  }
  return blocks;
};

const feedStory = (block: string, feedName: string): readonly Story[] => {
  const title = tagText(block, "title");
  const link = feedLink(block);
  const published = tagText(block, "pubDate")
    || tagText(block, "published")
    || tagText(block, "updated");
  return title.length > 0 && link.length > 0
    ? [{
      title,
      url: link,
      source: `rss:${feedName}`,
      publishedAt: normalizeDate(published),
    }]
    : [];
};

const feedLink = (block: string): string => {
  const text = tagText(block, "link");
  if (text.length > 0) return text;
  return /<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? "";
};

const tagText = (block: string, tag: string): string => {
  const lower = block.toLowerCase();
  const open = lower.indexOf(`<${tag}`);
  if (open === -1) return "";
  const gt = block.indexOf(">", open);
  const close = lower.indexOf(`</${tag}>`, gt);
  if (gt === -1 || close === -1) return "";
  return cleanText(block.slice(gt + 1, close));
};

const cleanText = (raw: string): string =>
  stripTags(raw.replaceAll("<![CDATA[", "").replaceAll("]]>", ""))
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(/\s+/g, " ")
    .trim();

const stripTags = (input: string): string => {
  let output = "";
  let cursor = 0;
  for (;;) {
    const start = input.indexOf("<", cursor);
    if (start === -1) return output + input.slice(cursor);
    const end = input.indexOf(">", start + 1);
    if (end === -1) return output + input.slice(cursor);
    output += `${input.slice(cursor, start)} `;
    cursor = end + 1;
  }
};

const normalizeDate = (value: string): string => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
};
