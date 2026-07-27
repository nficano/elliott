import type { NewsBriefSettings } from "../../../src/runtime/types";
import type { AggregatedStory, ScoredStory, Story } from "./types";

const RECENCY_WINDOW_HOURS = 6;
const BURST_NORM = 5;
const CORROB_NORM = 4;
const WEIGHT_RECENCY = 0.4;
const WEIGHT_BURST = 0.2;
const WEIGHT_CORROB = 0.3;
const WEIGHT_KEYWORD = 0.2;
const MS_PER_HOUR = 3_600_000;
const NEUTRAL_RECENCY = 0.5;
const SIGNATURE_MIN_WORD = 4;
const SIGNATURE_WORDS = 6;
const ROUND_FACTOR = 100;

export const keyFor = (story: Story): string =>
  titleKey(story.title) || urlKey(story.url);

const titleKey = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= SIGNATURE_MIN_WORD)
    .slice(0, SIGNATURE_WORDS)
    .join(" ");

const urlKey = (url: string): string => {
  let value = url.toLowerCase();
  for (const scheme of ["https://", "http://"]) {
    if (value.startsWith(scheme)) {
      value = value.slice(scheme.length);
      break;
    }
  }
  const cut = value.search(/[?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
};

export const mergeStory = (
  map: Map<string, AggregatedStory>,
  story: Story,
  now: number,
): void => {
  const key = keyFor(story);
  if (key.length === 0) return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, {
      key,
      title: story.title,
      url: story.url,
      sources: new Set([story.source]),
      mentions: 1,
      firstSeen: now,
      lastSeen: now,
      publishedAt: story.publishedAt,
    });
    return;
  }
  existing.sources.add(story.source);
  existing.mentions += 1;
  existing.lastSeen = now;
  if (fresher(story.publishedAt, existing.publishedAt)) {
    existing.publishedAt = story.publishedAt;
  }
};

export const pruneStories = (
  map: Map<string, AggregatedStory>,
  now: number,
  retentionMs: number,
): void => {
  for (const [key, story] of map) {
    if (now - story.lastSeen > retentionMs) map.delete(key);
  }
};

export const scoreAll = (
  map: ReadonlyMap<string, AggregatedStory>,
  settings: NewsBriefSettings,
  now: number,
): readonly ScoredStory[] =>
  [...map.values()]
    .map((story) => toScored(story, settings, now))
    .sort((left, right) => right.score - left.score);

const toScored = (
  story: AggregatedStory,
  settings: NewsBriefSettings,
  now: number,
): ScoredStory => {
  const score = scoreStory(story, settings.keywords, now);
  return {
    title: story.title,
    url: story.url,
    sources: [...story.sources].sort((left, right) =>
      left.localeCompare(right)
    ),
    score: Math.round(score * ROUND_FACTOR) / ROUND_FACTOR,
    publishedAt: story.publishedAt,
    breaking: score >= settings.threshold,
  };
};

const scoreStory = (
  story: AggregatedStory,
  keywords: readonly string[],
  now: number,
): number => {
  const recency = recencyScore(story.publishedAt, now);
  const burst = clamp01(story.mentions / BURST_NORM);
  const corrob = clamp01(story.sources.size / CORROB_NORM);
  const keyword = matchesKeyword(story.title, keywords) ? 1 : 0;
  return clamp01(
    WEIGHT_RECENCY * recency + WEIGHT_BURST * burst
      + WEIGHT_CORROB * corrob + WEIGHT_KEYWORD * keyword,
  );
};

const recencyScore = (publishedAt: string, now: number): number => {
  const parsed = Date.parse(publishedAt);
  if (Number.isNaN(parsed)) return NEUTRAL_RECENCY;
  const ageHours = (now - parsed) / MS_PER_HOUR;
  return clamp01(1 - ageHours / RECENCY_WINDOW_HOURS);
};

const matchesKeyword = (
  title: string,
  keywords: readonly string[],
): boolean => {
  const lower = title.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
};

const fresher = (candidate: string, current: string): boolean => {
  const next = Date.parse(candidate);
  if (Number.isNaN(next)) return false;
  const prev = Date.parse(current);
  if (Number.isNaN(prev)) return true;
  return next > prev;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
