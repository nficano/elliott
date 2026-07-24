import { isJsonRecord } from "../../providers/http";
import type { RuntimeModelUsage } from "../types";

const nonNegativeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

export const decodeRuntimeModelUsage = (
  payload: Readonly<Record<string, unknown>>,
): RuntimeModelUsage | undefined => {
  const usage = payload["usage"];
  if (!isJsonRecord(usage)) return undefined;
  const inputTokens = nonNegativeNumber(usage["prompt_tokens"]);
  const outputTokens = nonNegativeNumber(usage["completion_tokens"]);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  const hidden = payload["_hidden_params"];
  const costUsd = nonNegativeNumber(usage["cost"])
    ?? nonNegativeNumber(payload["response_cost"])
    ?? (isJsonRecord(hidden)
      ? nonNegativeNumber(hidden["response_cost"])
      : undefined)
    ?? 0;
  return { inputTokens, outputTokens, costUsd };
};
