import type { SubscriptionAccountSettings } from "../../../src/runtime/types";

export interface OauthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt?: number;
  readonly accountId?: string;
}

export interface UsageWindow {
  readonly window: string;
  readonly usedPercent: number;
  readonly resetsAt?: string;
}

export interface AccountUsage {
  readonly provider: "claude" | "codex";
  readonly account: string;
  readonly plan?: string;
  readonly windows: readonly UsageWindow[];
  readonly error?: string;
}

export interface TokenStore {
  load(key: string, seed: OauthTokens): Promise<OauthTokens>;
  save(key: string, seed: OauthTokens, tokens: OauthTokens): Promise<void>;
}

export interface UsageTarget {
  readonly provider: "claude" | "codex";
  readonly account: SubscriptionAccountSettings;
}

export interface SpendDayRow {
  readonly date: string;
  readonly spend: number;
  readonly requests: number;
  readonly tokens: number;
}

export interface UsageClient {
  readonly key: string;
  readonly label: string;
  readonly seed: OauthTokens;
  readonly expired?: (tokens: OauthTokens) => boolean;
  request(tokens: OauthTokens): Promise<Response>;
  refresh(tokens: OauthTokens): Promise<OauthTokens>;
}
