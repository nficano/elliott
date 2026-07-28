import { isJsonRecord } from "../../../src/providers/http";
import type { SubscriptionAccountSettings } from "../../../src/runtime/types";
import { parseCodexSeed } from "./tokens";
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

// The endpoint the official Codex CLI polls for its /status rate limits
// (codex-rs backend-client: {base_url}/wham/usage). Unofficial wire format;
// primary_window is the 5h meter, secondary_window the weekly one.
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

export const codexUsage = async (
  account: SubscriptionAccountSettings,
  store: TokenStore,
): Promise<AccountUsage> => {
  const payload = await fetchWithRefresh({
    key: `codex-${account.name}`,
    label: "ChatGPT usage API",
    seed: parseCodexSeed(account.credentials),
    request: (tokens) =>
      httpGet(USAGE_URL, {
        accept: "application/json",
        authorization: `Bearer ${tokens.accessToken}`,
        ...(tokens.accountId !== undefined
          && { "chatgpt-account-id": tokens.accountId }),
      }),
    refresh: refreshTokens,
  }, store);
  const record = isJsonRecord(payload) ? payload : {};
  const rateLimit = record["rate_limit"];
  const limits = isJsonRecord(rateLimit) ? rateLimit : {};
  const plan = stringField(record, "plan_type");
  return {
    provider: "codex",
    account: account.name,
    ...(plan !== undefined && { plan }),
    windows: [
      ...windowFrom(limits["primary_window"], "5h"),
      ...windowFrom(limits["secondary_window"], "7d"),
    ],
  };
};

// ChatGPT refresh tokens are single-use: the rotated pair returned here is
// persisted by fetchWithRefresh before any retry, and the seed in Vault goes
// stale after the first rotation (the token store keeps the live chain).
const refreshTokens = async (tokens: OauthTokens): Promise<OauthTokens> => {
  const payload = await postJson(TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  return {
    ...tokens,
    accessToken: stringField(payload, "access_token") ?? tokens.accessToken,
    refreshToken: stringField(payload, "refresh_token")
      ?? tokens.refreshToken,
  };
};

const windowFrom = (
  value: unknown,
  fallback: string,
): readonly UsageWindow[] => {
  const usedPercent = numberField(value, "used_percent");
  if (usedPercent === undefined) return [];
  const resetAt = numberField(value, "reset_at");
  return [{
    window: windowLabel(numberField(value, "limit_window_seconds"), fallback),
    usedPercent,
    ...(resetAt !== undefined && {
      resetsAt: new Date(resetAt * MILLISECONDS_PER_SECOND).toISOString(),
    }),
  }];
};

const windowLabel = (
  seconds: number | undefined,
  fallback: string,
): string => {
  if (seconds === undefined || seconds <= 0) return fallback;
  const hours = Math.round(seconds / SECONDS_PER_HOUR);
  if (hours < 1) return fallback;
  return hours >= HOURS_PER_DAY
    ? `${Math.round(hours / HOURS_PER_DAY)}d`
    : `${hours}h`;
};
