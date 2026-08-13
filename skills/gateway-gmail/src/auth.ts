import { isJsonRecord } from "../../../src/providers/http";
import type { GmailSettings } from "../../../src/runtime/types";
import type { TokenSource } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRY_SKEW_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 3600;

export const makeTokenSource = (settings: GmailSettings): TokenSource => {
  let token = "";
  let expiresAt = 0;
  return {
    token: async () => {
      if (token.length > 0 && Date.now() < expiresAt) return token;
      const minted = await mintAccessToken(settings);
      token = minted.token;
      expiresAt = minted.expiresAt;
      return token;
    },
  };
};

const mintAccessToken = async (
  settings: GmailSettings,
): Promise<{ readonly token: string; readonly expiresAt: number; }> => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      refresh_token: settings.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Gmail token endpoint returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isJsonRecord(payload) || typeof payload["access_token"] !== "string") {
    throw new Error("Gmail token endpoint returned an invalid payload");
  }
  const ttl = typeof payload["expires_in"] === "number"
    ? payload["expires_in"]
    : DEFAULT_TTL_SECONDS;
  return {
    token: payload["access_token"],
    expiresAt: Date.now()
      + (ttl - EXPIRY_SKEW_SECONDS) * MILLISECONDS_PER_SECOND,
  };
};
