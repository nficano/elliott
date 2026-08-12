import { isJsonRecord } from "../providers/http";
import {
  optionalNumberAt,
  optionalStringAt,
  stringArrayAt,
  valueAt,
} from "./settings";
import type {
  DeepTraceSettings,
  NewsBriefApiSource,
  NewsBriefGuardianSource,
  NewsBriefRedditSource,
  NewsBriefRssFeed,
  NewsBriefRssSource,
  NewsBriefSettings,
} from "./types";

const NEWS_DEFAULT_THRESHOLD = 0.6;
const NEWS_DEFAULT_BRIEF_SIZE = 8;
const NEWS_REDDIT_INTERVAL = 300;
const NEWS_GUARDIAN_INTERVAL = 600;
const NEWS_RSS_INTERVAL = 600;
const NEWS_API_INTERVAL = 900;
const DEFAULT_REDDIT_MULTI = "r/worldnews+news+politics";
const DEFAULT_GUARDIAN_SECTIONS = [
  "world",
  "us-news",
  "politics",
  "environment",
  "technology",
];
const DEFAULT_RSS_FEEDS: readonly NewsBriefRssFeed[] = [
  { name: "AP", url: "https://feeds.apnews.com/rss/apf-topnews" },
  { name: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
];

const flagAt = (value: unknown, keys: readonly string[]): boolean =>
  valueAt(value, keys) === true;

const NEWS = ["skills", "news_brief"];

export const optionalNewsBrief = (
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly newsBrief?: NewsBriefSettings; } => {
  if (!flagAt(resolved, [...NEWS, "enabled"])) return {};
  return {
    newsBrief: {
      keywords: stringArrayAt(resolved, [...NEWS, "keywords"]),
      threshold: optionalNumberAt(resolved, [...NEWS, "threshold"])
        ?? NEWS_DEFAULT_THRESHOLD,
      briefSize: optionalNumberAt(resolved, [...NEWS, "brief_size"])
        ?? NEWS_DEFAULT_BRIEF_SIZE,
      alerts: flagAt(resolved, [...NEWS, "alerts"]),
      ...newsReddit(resolved),
      ...newsGuardian(resolved, secrets),
      ...newsRss(resolved),
      ...newsdataSource(resolved, secrets),
      ...gnewsSource(resolved, secrets),
    },
  };
};

// Publishing the observability map on the LAN needs both halves of the
// address: the hostname to claim and where the reverse proxy finds the
// runtime. Either one missing keeps the publish dormant.
//
// The skill was renamed telemetry_map -> deep_trace. For one release the loader
// accepts BOTH config keys: it prefers skills.deep_trace and falls back to the
// legacy skills.telemetry_map (with a deprecation warning) so the live map does
// not go dark on the flag day. Drop the legacy branch a release later.
export const optionalDeepTrace = (
  resolved: unknown,
): { readonly deepTrace?: DeepTraceSettings; } => {
  const base = deepTraceConfigBase(resolved);
  if (!flagAt(resolved, [...base, "enabled"])) return {};
  const publicHostname = optionalStringAt(resolved, [
    ...base,
    "public_hostname",
  ]);
  const serviceUrl = optionalStringAt(resolved, [...base, "service_url"]);
  if (publicHostname === undefined || serviceUrl === undefined) return {};
  return { deepTrace: { publicHostname, serviceUrl } };
};

// Prefer the new key; fall back to the legacy one only when the new key is
// absent, warning once so operators migrate their config.
const deepTraceConfigBase = (resolved: unknown): readonly string[] => {
  const base = ["skills", "deep_trace"];
  if (valueAt(resolved, base) !== undefined) return base;
  const legacy = ["skills", "telemetry_map"];
  if (valueAt(resolved, legacy) === undefined) return base;
  console.warn("skills.telemetry_map is deprecated; use skills.deep_trace.");
  return legacy;
};

const newsReddit = (
  resolved: unknown,
): { readonly reddit?: NewsBriefRedditSource; } => {
  const base = [...NEWS, "reddit"];
  if (!flagAt(resolved, [...base, "enabled"])) return {};
  return {
    reddit: {
      multireddit: optionalStringAt(resolved, [...base, "multireddit"])
        ?? DEFAULT_REDDIT_MULTI,
      intervalSeconds: optionalNumberAt(resolved, [...base, "interval_seconds"])
        ?? NEWS_REDDIT_INTERVAL,
    },
  };
};

const newsGuardian = (
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly guardian?: NewsBriefGuardianSource; } => {
  const base = [...NEWS, "guardian"];
  const apiKey = secrets["guardian_api_key"];
  if (!flagAt(resolved, [...base, "enabled"]) || apiKey === undefined) {
    return {};
  }
  const sections = stringArrayAt(resolved, [...base, "sections"]);
  return {
    guardian: {
      apiKey,
      sections: sections.length > 0 ? sections : DEFAULT_GUARDIAN_SECTIONS,
      intervalSeconds: optionalNumberAt(resolved, [...base, "interval_seconds"])
        ?? NEWS_GUARDIAN_INTERVAL,
    },
  };
};

const newsRss = (
  resolved: unknown,
): { readonly rss?: NewsBriefRssSource; } => {
  const base = [...NEWS, "rss"];
  if (!flagAt(resolved, [...base, "enabled"])) return {};
  const feeds = rssFeeds(valueAt(resolved, [...base, "feeds"]));
  return {
    rss: {
      feeds: feeds.length > 0 ? feeds : DEFAULT_RSS_FEEDS,
      intervalSeconds: optionalNumberAt(resolved, [...base, "interval_seconds"])
        ?? NEWS_RSS_INTERVAL,
    },
  };
};

const rssFeeds = (value: unknown): readonly NewsBriefRssFeed[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isJsonRecord(item)) return [];
    const name = item["name"];
    const url = item["url"];
    return typeof name === "string" && typeof url === "string"
      ? [{ name, url }]
      : [];
  });
};

const newsdataSource = (
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly newsdata?: NewsBriefApiSource; } => {
  const source = apiSource("newsdata", resolved, secrets["newsdata_api_key"]);
  return source === undefined ? {} : { newsdata: source };
};

const gnewsSource = (
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly gnews?: NewsBriefApiSource; } => {
  const source = apiSource("gnews", resolved, secrets["gnews_api_key"]);
  return source === undefined ? {} : { gnews: source };
};

const apiSource = (
  name: string,
  resolved: unknown,
  apiKey: string | undefined,
): NewsBriefApiSource | undefined => {
  const base = [...NEWS, name];
  if (!flagAt(resolved, [...base, "enabled"]) || apiKey === undefined) {
    return undefined;
  }
  return {
    apiKey,
    intervalSeconds: optionalNumberAt(resolved, [...base, "interval_seconds"])
      ?? NEWS_API_INTERVAL,
  };
};

// Agent-local skills (loaded from agents/<name>/skills/) own their config
// schemas. The raw resolved `skills:` subtree passes through verbatim so those
// skills decode their own blocks; framework and registry skills keep the typed
// loaders above.
export const optionalSkillConfig = (
  resolved: unknown,
): { readonly skillConfig?: Readonly<Record<string, unknown>>; } => {
  const value = valueAt(resolved, ["skills"]);
  return isJsonRecord(value) ? { skillConfig: value } : {};
};
