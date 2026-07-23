import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolCtx, ToolDef } from "../../core/agent/types.js";
import type {
  Manifest,
  Registrable,
  ScheduleSpec,
} from "../../host/registry/types.js";
import { SpikeWatchConfig } from "./schema.js";
import { createSpikeChecker } from "./spike/checker.js";
import type { Cfg, SpikeWatchOverrides } from "./types.js";

/**
 * The `spike-watch` skill (CAPABILITIES-TDD §9.3): a deterministic triage loop
 * over `issue-feed@1` — baseline on first success, threshold + seen-set +
 * ignore-list + self-guard selection, flap cooldown, optional correlation
 * against `change-feed@1`. The model only narrates; detection is code. A
 * scheduled run with nothing fresh replies [SILENT] (§15).
 */

const manifest: Manifest<Cfg> = {
  id: "spike-watch",
  kind: "skill",
  version: "0.1.0",
  configSchema: SpikeWatchConfig,
  bundle: "ops",
  trust: "read",
  defaultTier: "fast",
  capabilities: ["reads:issues"],
  contracts: { tools: ["spike_check"] },
};

export function spikeWatchSkill(
  overrides: SpikeWatchOverrides = {},
): Registrable<Cfg> {
  return {
    manifest,
    async activate(ctx) {
      const cfg = ctx.config;
      const now = overrides.now ?? (() => Date.now());
      const check = createSpikeChecker({
        cfg,
        now,
        ...(ctx.caps && { caps: ctx.caps }),
      });
      return { tools: [makeTool(check)], schedules: makeSchedules(cfg) };
    },
  };
}

function makeTool(check: (toolCtx: ToolCtx) => Promise<string>): ToolDef {
  return define({
    name: "spike_check",
    description:
      "Poll the issue feed for FRESH spikes (over the volume floor, unseen, not ignored, not "
      + "about this agent, outside cooldown), each correlated against recent changes when a "
      + "change feed is configured. Detection is deterministic — narrate the result, don't re-derive it.",
    schema: Schema.Struct({}),
    meta: {
      componentId: "spike-watch",
      bundle: "ops",
      core: false,
      write: false,
    },
    run: (_args, toolCtx) => check(toolCtx),
  });
}

function makeSchedules(cfg: Cfg): ScheduleSpec[] {
  return cfg.schedule
    ? [{
      id: "spike-watch",
      cron: cfg.schedule as string,
      prompt:
        "Run spike_check. If `fresh` is empty (or it reports baseline/skipped), reply exactly "
        + "[SILENT]. Otherwise summarize each fresh spike in one line — title, count, link, and "
        + "the related change if any — and suggest 'investigate <key>' as the follow-up.",
    }]
    : [];
}

export function opsPack(overrides: SpikeWatchOverrides = {}): Registrable[] {
  return [spikeWatchSkill(overrides)];
}
