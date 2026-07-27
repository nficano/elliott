import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../src/providers/http";
import { stringValue } from "../../../src/runtime/skills/http";
import { parseFeed } from "./rss";
import type {
  ApiSourceConfig,
  GuardianSourceConfig,
  NewsSource,
  RedditSourceConfig,
  RssFeedConfig,
  RssSourceConfig,
  Story,
} from "./types";

const REDDIT_BASE = "https://www.reddit.com";
const GUARDIAN_BASE = "https://content.guardianapis.com";
const NEWSDATA_BASE = "https://newsdata.io/api/1";
const GNEWS_BASE = "https://gnews.io/api/v4";
const USER_AGENT = "elliott-news-brief/1.0";
const FETCH_TIMEOUT_MS = 15_000;
const REDDIT_LIMIT = 50;
const GUARDIAN_PAGE_SIZE = 20;

export const buildSources = (settings: object): readonly NewsSource[] => {
  if (!isJsonRecord(settings)) return [];
  return [
    ...sourceIf(asRedditSource(settings["reddit"]), redditSource),
    ...sourceIf(asGuardianSource(settings["guardian"]), guardianSource),
    ...sourceIf(asRssSource(settings["rss"]), rssSource),
    ...sourceIf(asApiSource(settings["newsdata"]), newsdataSource),
    ...sourceIf(asApiSource(settings["gnews"]), gnewsSource),
  ];
};

const sourceIf = <T>(
  config: T | undefined,
  build: (config: T) => NewsSource,
): readonly NewsSource[] => config === undefined ? [] : [build(config)];

const asInterval = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asStringList = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string =>
    typeof item === "string"
  );
  return items.length === value.length ? items : undefined;
};

const asRedditSource = (value: unknown): RedditSourceConfig | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const multireddit = asString(value["multireddit"]);
  const intervalSeconds = asInterval(value["intervalSeconds"]);
  if (multireddit === undefined || intervalSeconds === undefined) {
    return undefined;
  }
  return { multireddit, intervalSeconds };
};

const asGuardianSource = (
  value: unknown,
): GuardianSourceConfig | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const apiKey = asString(value["apiKey"]);
  const sections = asStringList(value["sections"]);
  const intervalSeconds = asInterval(value["intervalSeconds"]);
  if (
    apiKey === undefined || sections === undefined
    || intervalSeconds === undefined
  ) {
    return undefined;
  }
  return { apiKey, sections, intervalSeconds };
};

const asRssSource = (value: unknown): RssSourceConfig | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const intervalSeconds = asInterval(value["intervalSeconds"]);
  const rawFeeds = value["feeds"];
  if (intervalSeconds === undefined || !Array.isArray(rawFeeds)) {
    return undefined;
  }
  const feeds = rawFeeds.flatMap(asRssFeed);
  if (feeds.length !== rawFeeds.length) return undefined;
  return { feeds, intervalSeconds };
};

const asRssFeed = (value: unknown): readonly RssFeedConfig[] => {
  if (!isJsonRecord(value)) return [];
  const name = asString(value["name"]);
  const url = asString(value["url"]);
  return name === undefined || url === undefined ? [] : [{ name, url }];
};

const asApiSource = (value: unknown): ApiSourceConfig | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const apiKey = asString(value["apiKey"]);
  const intervalSeconds = asInterval(value["intervalSeconds"]);
  if (apiKey === undefined || intervalSeconds === undefined) return undefined;
  return { apiKey, intervalSeconds };
};

const toStory = (
  source: string,
  raw: { readonly title: string; readonly url: string; readonly at: string; },
): readonly Story[] =>
  raw.title.length > 0 && raw.url.length > 0
    ? [{ source, title: raw.title, url: raw.url, publishedAt: raw.at }]
    : [];

const fetchJson = async (
  url: string | URL,
  headers: Readonly<Record<string, string>> = {},
): Promise<unknown> => {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  }
  return response.json();
};

// Reddit hard-403s the anonymous .json API from datacenter egress, but the
// Atom .rss feed for the same multireddit still serves 200 with no auth, so we
// read that and parse it with the shared feed parser. RSS carries no upvote
// score; the scorer's recency/burst/corroboration signals do the ranking.
const redditSource = (config: RedditSourceConfig): NewsSource => ({
  name: "reddit",
  intervalSeconds: config.intervalSeconds,
  fetch: async () => {
    const path = config.multireddit
      .split("?", 1)[0]
      ?.split("/")
      .filter(Boolean)
      .join("/") ?? "";
    try {
      const response = await fetch(
        `${REDDIT_BASE}/${path}/.rss?limit=${REDDIT_LIMIT}`,
        {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!response.ok) return [];
      return parseFeed(await response.text(), "reddit").map((story) => ({
        ...story,
        source: "reddit",
      }));
    } catch {
      return [];
    }
  },
});

const guardianSource = (config: GuardianSourceConfig): NewsSource => ({
  name: "guardian",
  intervalSeconds: config.intervalSeconds,
  fetch: async () => {
    const url = new URL(`${GUARDIAN_BASE}/search`);
    url.searchParams.set("api-key", config.apiKey);
    url.searchParams.set("section", config.sections.join("|"));
    url.searchParams.set("order-by", "newest");
    url.searchParams.set("page-size", String(GUARDIAN_PAGE_SIZE));
    const payload = await fetchJson(url);
    const response = isJsonRecord(payload)
      ? nestedRecord(payload, "response")
      : undefined;
    return response === undefined
      ? []
      : recordArray(response, "results").flatMap(guardianStory);
  },
});

const guardianStory = (
  item: Readonly<Record<string, unknown>>,
): readonly Story[] =>
  toStory("guardian", {
    title: stringValue(item["webTitle"]),
    url: stringValue(item["webUrl"]),
    at: stringValue(item["webPublicationDate"]),
  });

const newsdataSource = (config: ApiSourceConfig): NewsSource => ({
  name: "newsdata",
  intervalSeconds: config.intervalSeconds,
  fetch: async () => {
    const url = new URL(`${NEWSDATA_BASE}/news`);
    url.searchParams.set("apikey", config.apiKey);
    url.searchParams.set("language", "en");
    const payload = await fetchJson(url);
    return isJsonRecord(payload)
      ? recordArray(payload, "results").flatMap(newsdataStory)
      : [];
  },
});

const newsdataStory = (
  item: Readonly<Record<string, unknown>>,
): readonly Story[] =>
  toStory("newsdata", {
    title: stringValue(item["title"]),
    url: stringValue(item["link"]),
    at: stringValue(item["pubDate"]),
  });

const gnewsSource = (config: ApiSourceConfig): NewsSource => ({
  name: "gnews",
  intervalSeconds: config.intervalSeconds,
  fetch: async () => {
    const url = new URL(`${GNEWS_BASE}/top-headlines`);
    url.searchParams.set("lang", "en");
    url.searchParams.set("token", config.apiKey);
    const payload = await fetchJson(url);
    return isJsonRecord(payload)
      ? recordArray(payload, "articles").flatMap(gnewsStory)
      : [];
  },
});

const gnewsStory = (
  item: Readonly<Record<string, unknown>>,
): readonly Story[] =>
  toStory("gnews", {
    title: stringValue(item["title"]),
    url: stringValue(item["url"]),
    at: stringValue(item["publishedAt"]),
  });

const rssSource = (config: RssSourceConfig): NewsSource => ({
  name: "rss",
  intervalSeconds: config.intervalSeconds,
  fetch: async () => {
    const groups = await Promise.all(config.feeds.map(fetchFeed));
    return groups.flat();
  },
});

const fetchFeed = async (
  feed: RssSourceConfig["feeds"][number],
): Promise<readonly Story[]> => {
  try {
    const response = await fetch(feed.url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml,"
          + " text/xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? parseFeed(await response.text(), feed.name) : [];
  } catch {
    return [];
  }
};
