import type { NewsBriefSettings } from "../../../src/runtime/types";
import { mergeStory, pruneStories, scoreAll } from "./score";
import type { AggregatedStory, NewsEngine, NewsSource } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const RETENTION_MS = 86_400_000;

// The engine is a pure aggregation + scoring read model: it polls each source
// on its own cadence, deduplicates stories, and exposes the scored brief.
// Delivery of alerts is a separate concern layered on top (see alerts.ts).
export const makeNewsEngine = (
  sources: readonly NewsSource[],
  settings: NewsBriefSettings,
  report: (error: unknown, mechanism: string) => void,
): NewsEngine => {
  const stories = new Map<string, AggregatedStory>();
  const lastPolled = new Map<string, number>();
  const refresh = async (): Promise<void> => {
    const now = Date.now();
    for (const source of sources) {
      if (!due(source, lastPolled, now)) continue;
      lastPolled.set(source.name, now);
      try {
        for (const story of await source.fetch()) {
          mergeStory(stories, story, now);
        }
      } catch (error) {
        report(error, `news-brief:source:${source.name}`);
      }
    }
    pruneStories(stories, now, RETENTION_MS);
  };
  return {
    refresh,
    brief: () => scoreAll(stories, settings, Date.now()),
  };
};

const due = (
  source: NewsSource,
  lastPolled: ReadonlyMap<string, number>,
  now: number,
): boolean => {
  const last = lastPolled.get(source.name);
  return last === undefined
    || now - last >= source.intervalSeconds * MILLISECONDS_PER_SECOND;
};
