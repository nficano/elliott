import path from "node:path";
import type {
  ServiceBinding,
  SkillContext,
} from "../../../src/runtime/skills/types";
import { makeAlertStore } from "./store";
import type { AlertStore, NewsEngine, NewsSource, ScoredStory } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const MIN_TICK_SECONDS = 30;
const DEFAULT_TICK_SECONDS = 300;

// Delivery layer over the scoring engine: when a story first crosses the
// breaking threshold it is pushed once through the runtime's outbound path.
export const alertService = (
  engine: NewsEngine,
  sources: readonly NewsSource[],
  context: SkillContext,
): ServiceBinding => {
  const store = makeAlertStore(path.join(context.stateDirectory, "news-brief"));
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = (): void => {
    run(engine, store, context).catch((error: unknown) =>
      context.report(error, "news-brief:tick")
    );
  };
  return {
    name: "news-brief",
    start: () => {
      tick();
      timer = setInterval(
        tick,
        tickSeconds(sources) * MILLISECONDS_PER_SECOND,
      );
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
    },
  };
};

const run = async (
  engine: NewsEngine,
  store: AlertStore,
  context: SkillContext,
): Promise<void> => {
  await engine.refresh();
  const seen = await store.seen();
  for (const story of engine.brief()) {
    if (!story.breaking || seen.has(story.url)) continue;
    await context.deliver(alertText(story));
    await store.mark(story.url);
  }
};

const alertText = (story: ScoredStory): string =>
  `:newspaper: Breaking: ${story.title} — ${story.sources.join(", ")}\n`
  + story.url;

const tickSeconds = (sources: readonly NewsSource[]): number => {
  if (sources.length === 0) return DEFAULT_TICK_SECONDS;
  const intervals = sources.map((source) => source.intervalSeconds);
  return Math.max(MIN_TICK_SECONDS, Math.min(...intervals));
};
