import type { Cfg } from "./types.js";

const ISO_DAY_LENGTH = 10;
const TREND_RESULT_LIMIT = 10;

export function isoDay(now: () => Date): string {
  return now().toISOString().slice(0, ISO_DAY_LENGTH);
}

export function aggregateOptions(cfg: Cfg) {
  return {
    metric: cfg.metric,
    ...(cfg.activity_metric && { activityMetric: cfg.activity_metric }),
  };
}

export function diffOptions(cfg: Cfg) {
  return {
    metric: cfg.metric,
    direction: cfg.direction,
    moveThreshold: cfg.move_threshold,
    ...(cfg.activity_metric && { activityMetric: cfg.activity_metric }),
    ...((cfg.act_now_min !== undefined) && { actNowMin: cfg.act_now_min }),
  };
}

export function decayOptions(cfg: Cfg) {
  return {
    metric: cfg.metric,
    direction: cfg.direction,
    slideThreshold: cfg.slide_threshold,
    ...(cfg.activity_metric && {
      weightMetric: cfg.activity_metric,
      activityMetric: cfg.activity_metric,
      activityMin: 1,
    }),
    limit: TREND_RESULT_LIMIT,
  };
}

export function splitOptions(cfg: Cfg) {
  return {
    weightMetric: cfg.activity_metric!,
    shareMin: cfg.share_min,
    weightMin: cfg.weight_min,
    limit: TREND_RESULT_LIMIT,
  };
}
