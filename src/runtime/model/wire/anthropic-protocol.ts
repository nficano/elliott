import type { RuntimeModelUsage } from "../../types";

export const WIRE_NAME = "Anthropic";

// Pinned deliberately: the version header selects response semantics, so it
// must change only with a reviewed migration, never by drifting default.
export const ANTHROPIC_VERSION = "2023-06-01";

export const tokenCount = (
  usage: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined => {
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
};

export const usageOf = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): RuntimeModelUsage | undefined =>
  inputTokens === undefined && outputTokens === undefined
    ? undefined
    // Anthropic bills off-invoice rather than per-response, so there is no
    // cost field to read; 0 means "not reported", as on any non-LiteLLM route.
    : {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      costUsd: 0,
    };
