import { isJsonRecord } from "../providers/http";
import {
  optionalNumberAt,
  optionalStringAt,
  stringArrayAt,
  valueAt,
} from "./settings";
import type {
  NewsBriefApiSource,
  NewsBriefGuardianSource,
  NewsBriefRedditSource,
  NewsBriefRssFeed,
  NewsBriefRssSource,
  NewsBriefSettings,
  PakmanSettings,
  YouTubeDvrProviderRef,
  YouTubeDvrSettings,
  YouTubeOAuthSettings,
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

export const optionalPakman = (
  secrets: Readonly<Record<string, string>>,
): { readonly pakman?: PakmanSettings; } => {
  const username = secrets["pakman_username"];
  const password = secrets["pakman_password"];
  if (username === undefined || password === undefined) return {};
  return { pakman: { username, password } };
};

const YT = ["skills", "youtube_dvr"];
const YT_DEFAULT_WINDOW_START = 6;
const YT_DEFAULT_WINDOW_END = 24;
const YT_DEFAULT_LOOKBACK = 600;
const YT_DEFAULT_MIN_DURATION = 300;
const YT_DEFAULT_POLL_INTERVAL = 3600;
const YT_DEFAULT_TEMPLATE = "{dayName}, {month} {day}{ordinal}";
const YT_DEFAULT_PRIVACY = "unlisted";
const DEFAULT_TIMEZONE = "UTC";

export const optionalYouTubeDvr = (
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly youtubeDvr?: YouTubeDvrSettings; } => {
  if (!flagAt(resolved, [...YT, "enabled"])) return {};
  const oauth = youtubeOauth(secrets);
  if (oauth === undefined) return {};
  return { youtubeDvr: { oauth, ...youtubeDvrTuning(resolved) } };
};

const youtubeDvrTuning = (
  resolved: unknown,
): Omit<YouTubeDvrSettings, "oauth"> => ({
  channels: stringArrayAt(resolved, [...YT, "channels"]),
  providers: providerRefs(valueAt(resolved, [...YT, "providers"])),
  timezone: optionalStringAt(resolved, [...YT, "timezone"])
    ?? optionalStringAt(resolved, ["runtime", "timezone"]) ?? DEFAULT_TIMEZONE,
  windowStartHour: optionalNumberAt(resolved, [...YT, "window_start_hour"])
    ?? YT_DEFAULT_WINDOW_START,
  windowEndHour: optionalNumberAt(resolved, [...YT, "window_end_hour"])
    ?? YT_DEFAULT_WINDOW_END,
  lookbackSeconds: optionalNumberAt(resolved, [...YT, "lookback_seconds"])
    ?? YT_DEFAULT_LOOKBACK,
  minDurationSeconds:
    optionalNumberAt(resolved, [...YT, "min_duration_seconds"])
      ?? YT_DEFAULT_MIN_DURATION,
  pollIntervalSeconds:
    optionalNumberAt(resolved, [...YT, "poll_interval_seconds"])
      ?? YT_DEFAULT_POLL_INTERVAL,
  playlistTitleTemplate:
    optionalStringAt(resolved, [...YT, "playlist_title_template"])
      ?? YT_DEFAULT_TEMPLATE,
  playlistPrivacy: optionalStringAt(resolved, [...YT, "playlist_privacy"])
    ?? YT_DEFAULT_PRIVACY,
  tool: valueAt(resolved, [...YT, "tool"]) !== false,
});

const youtubeOauth = (
  secrets: Readonly<Record<string, string>>,
): YouTubeOAuthSettings | undefined => {
  const clientId = secrets["youtube_client_id"];
  const clientSecret = secrets["youtube_client_secret"];
  const refreshToken = secrets["youtube_refresh_token"];
  if (
    clientId === undefined || clientSecret === undefined
    || refreshToken === undefined
  ) return undefined;
  return { clientId, clientSecret, refreshToken };
};

const providerRefs = (value: unknown): readonly YouTubeDvrProviderRef[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ name: item, days: [] }];
    if (!isJsonRecord(item) || typeof item["name"] !== "string") return [];
    return [{ name: item["name"], days: providerDays(item["days"]) }];
  });
};

const providerDays = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value
      .filter((day): day is string => typeof day === "string")
      .map((day) => day.toLowerCase())
    : [];
