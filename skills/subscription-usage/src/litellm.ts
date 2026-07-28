import { isJsonRecord } from "../../../src/providers/http";
import {
  objectSchema,
  optionalInteger,
} from "../../../src/runtime/skills/http";
import type {
  LitellmSpendSettings,
  ToolDefinition,
} from "../../../src/runtime/types";
import type { SpendDayRow } from "./types";
import { httpGet, numberField, stringField } from "./wire";

// /user/daily/activity is the endpoint the LiteLLM UI itself uses — the
// stable, typed spend surface (the /global/spend* routes are beta).
const ACTIVITY_PATH = "/user/daily/activity";
const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 90;
const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE_LENGTH = 10;
const SPEND_DECIMALS = 1e4;

export const litellmSpendTool = (
  settings: LitellmSpendSettings,
): ToolDefinition => ({
  name: "litellm_spend",
  description: "Report LiteLLM proxy spend for the last N days (default 7): "
    + "total cost, per-day cost with request and token counts, and spend per "
    + "model.",
  inputSchema: objectSchema({
    days: { type: "integer", minimum: MIN_DAYS, maximum: MAX_DAYS },
  }, []),
  execute: async (input) => {
    const days = optionalInteger(input, "days", {
      min: MIN_DAYS,
      max: MAX_DAYS,
      fallback: DEFAULT_DAYS,
    });
    const response = await httpGet(activityUrl(settings.baseUrl, days), {
      accept: "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    });
    if (!response.ok) {
      throw new Error(`LiteLLM returned HTTP ${response.status}`);
    }
    return JSON.stringify(summarize(await response.json()));
  },
});

const activityUrl = (baseUrl: string, days: number): string => {
  const end = Date.now();
  const start = end - (days - 1) * MILLISECONDS_PER_DAY;
  const url = new URL(ACTIVITY_PATH, baseUrl);
  url.searchParams.set("start_date", isoDate(start));
  url.searchParams.set("end_date", isoDate(end));
  url.searchParams.set("page_size", String(days));
  return url.href;
};

const isoDate = (epochMilliseconds: number): string =>
  new Date(epochMilliseconds).toISOString().slice(0, ISO_DATE_LENGTH);

const summarize = (payload: unknown): unknown => {
  const record = isJsonRecord(payload) ? payload : {};
  const results = Array.isArray(record["results"]) ? record["results"] : [];
  const metadata = record["metadata"];
  const modelSpend: Record<string, number> = {};
  const days = results.flatMap((item) => dayRow(item, modelSpend));
  const fallbackTotal = days.reduce((sum, row) => sum + row.spend, 0);
  for (const model of Object.keys(modelSpend)) {
    modelSpend[model] = round(modelSpend[model] ?? 0);
  }
  return {
    totalSpend: round(numberField(metadata, "total_spend") ?? fallbackTotal),
    totalRequests: numberField(metadata, "total_api_requests") ?? 0,
    totalTokens: numberField(metadata, "total_tokens") ?? 0,
    days,
    modelSpend,
  };
};

const dayRow = (
  value: unknown,
  modelSpend: Record<string, number>,
): readonly SpendDayRow[] => {
  if (!isJsonRecord(value)) return [];
  const metrics = value["metrics"];
  collectModelSpend(value["breakdown"], modelSpend);
  return [{
    date: stringField(value, "date") ?? "",
    spend: round(numberField(metrics, "spend") ?? 0),
    requests: numberField(metrics, "api_requests") ?? 0,
    tokens: numberField(metrics, "total_tokens") ?? 0,
  }];
};

const collectModelSpend = (
  breakdown: unknown,
  modelSpend: Record<string, number>,
): void => {
  if (!isJsonRecord(breakdown) || !isJsonRecord(breakdown["models"])) return;
  for (const [model, entry] of Object.entries(breakdown["models"])) {
    const spend = numberField(entry, "spend")
      ?? (isJsonRecord(entry)
        ? numberField(entry["metrics"], "spend")
        : undefined);
    if (spend !== undefined) {
      modelSpend[model] = (modelSpend[model] ?? 0) + spend;
    }
  }
};

const round = (value: number): number =>
  Math.round(value * SPEND_DECIMALS) / SPEND_DECIMALS;
