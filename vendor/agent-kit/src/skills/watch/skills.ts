import type {
  Manifest,
  Registrable,
  ScheduleSpec,
} from "../../host/registry/types.js";
import { WatchConfig } from "./schema.js";
import { makeMemoryWatchStore } from "./store.js";
import type { Cfg, WatchOverrides } from "./types.js";
import { createWatchTools } from "./watch-tools.js";

const manifest: Manifest<Cfg> = {
  id: "watch",
  kind: "skill",
  version: "0.1.0",
  configSchema: WatchConfig,
  bundle: "ops",
  trust: "read",
  defaultTier: "fast",
  capabilities: ["reads:metrics"],
  contracts: {
    tools: [
      "watch_snapshot",
      "watch_trends",
      "watch_outcome_record",
      "watch_outcomes",
    ],
  },
};

export function watchSkill(overrides: WatchOverrides = {}): Registrable<Cfg> {
  return {
    manifest,
    async activate(ctx) {
      const cfg = ctx.config;
      const store = overrides.store ?? makeMemoryWatchStore();
      const now = overrides.now ?? (() => new Date());
      const tools = createWatchTools({
        cfg,
        store,
        now,
        ...(ctx.caps && { caps: ctx.caps }),
      });
      return { tools, schedules: makeSchedules(cfg) };
    },
  };
}

function makeSchedules(cfg: Cfg): ScheduleSpec[] {
  return cfg.schedule
    ? [{
      id: "watch",
      cron: cfg.schedule as string,
      prompt:
        "Run watch_snapshot, then watch_outcomes. Summarize noteworthy movement with the "
        + "compared-to window stated. If nothing is noteworthy, reply exactly [SILENT].",
    }]
    : [];
}

export function watchPack(overrides: WatchOverrides = {}): Registrable[] {
  return [watchSkill(overrides)];
}
