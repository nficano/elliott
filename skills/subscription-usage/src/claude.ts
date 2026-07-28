import { isJsonRecord } from "../../../src/providers/http";
import type { SubscriptionAccountSettings } from "../../../src/runtime/types";
import { parseClaudeSeed } from "./tokens";
import type {
  AccountUsage,
  OauthTokens,
  TokenStore,
  UsageWindow,
} from "./types";
import {
  fetchWithRefresh,
  httpGet,
  numberField,
  postJson,
  stringField,
} from "./wire";

// The OAuth-authenticated endpoints Claude Code itself polls for /usage.
// Unofficial but stable since 2025; the beta header is required.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_BETA = "oauth-2025-04-20";
const EXPIRY_BUFFER_MILLISECONDS = 300_000;
const MILLISECONDS_PER_SECOND = 1000;

const WINDOW_KEYS: readonly (readonly [string, string])[] = [
  ["five_hour", "5h"],
  ["seven_day", "7d"],
  ["seven_day_opus", "7d_opus"],
  ["seven_day_sonnet", "7d_sonnet"],
];

export const claudeUsage = async (
  account: SubscriptionAccountSettings,
  store: TokenStore,
): Promise<AccountUsage> => {
  const payload = await fetchWithRefresh({
    key: `claude-${account.name}`,
    label: "Anthropic usage API",
    seed: parseClaudeSeed(account.credentials),
    expired: (tokens) =>
      tokens.expiresAt !== undefined
      && tokens.expiresAt - EXPIRY_BUFFER_MILLISECONDS < Date.now(),
    request: (tokens) =>
      httpGet(USAGE_URL, {
        accept: "application/json",
        authorization: `Bearer ${tokens.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
      }),
    refresh: refreshTokens,
  }, store);
  return {
    provider: "claude",
    account: account.name,
    ...plan(account.credentials),
    windows: parseWindows(payload),
  };
};

const refreshTokens = async (tokens: OauthTokens): Promise<OauthTokens> => {
  const payload = await postJson(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: CLIENT_ID,
  });
  const accessToken = stringField(payload, "access_token");
  if (accessToken === undefined) {
    throw new Error("Anthropic token refresh returned no access token");
  }
  const expiresIn = numberField(payload, "expires_in");
  return {
    accessToken,
    // Anthropic rotates the refresh token opportunistically; keep the old
    // one when the response omits it.
    refreshToken: stringField(payload, "refresh_token") ?? tokens.refreshToken,
    ...(expiresIn !== undefined && {
      expiresAt: Date.now() + expiresIn * MILLISECONDS_PER_SECOND,
    }),
  };
};

const parseWindows = (payload: unknown): readonly UsageWindow[] => {
  if (!isJsonRecord(payload)) return [];
  const named = WINDOW_KEYS.flatMap(([key, label]) =>
    windowFrom(payload[key], label)
  );
  return [...named, ...scopedLimits(payload["limits"])];
};

const windowFrom = (value: unknown, label: string): readonly UsageWindow[] => {
  const usedPercent = numberField(value, "utilization");
  if (usedPercent === undefined) return [];
  const resetsAt = stringField(value, "resets_at");
  return [{
    window: label,
    usedPercent,
    ...(resetsAt !== undefined && { resetsAt }),
  }];
};

// Newer accounts report model-scoped weekly limits through `limits` instead
// of the flat seven_day_* fields.
const scopedLimits = (value: unknown): readonly UsageWindow[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const usedPercent = numberField(item, "percent");
    if (usedPercent === undefined) return [];
    const group = stringField(item, "group") ?? "limit";
    const model = isJsonRecord(item) && isJsonRecord(item["scope"])
      ? stringField(item["scope"]["model"], "display_name")
      : undefined;
    const resetsAt = stringField(item, "resets_at");
    return [{
      window: model === undefined ? group : `${group} (${model})`,
      usedPercent,
      ...(resetsAt !== undefined && { resetsAt }),
    }];
  });
};

const plan = (credentials: string): { readonly plan?: string; } => {
  try {
    const payload: unknown = JSON.parse(credentials);
    const record = isJsonRecord(payload)
        && isJsonRecord(payload["claudeAiOauth"])
      ? payload["claudeAiOauth"]
      : payload;
    const value = stringField(record, "subscriptionType");
    return value === undefined ? {} : { plan: value };
  } catch {
    return {};
  }
};
