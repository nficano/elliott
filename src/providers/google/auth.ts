import { isJsonRecord } from "../http";
import type { GoogleCredentials, GoogleTokenSource } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRY_SKEW_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 3600;

// Mints and caches a Google OAuth access token from a refresh token. The token
// carries whatever scopes the refresh token was granted (Gmail, Calendar,
// People), so one source serves every Google API for that account. One source
// per account gives per-account caching for free.
export const makeGoogleTokenSource = (
  credentials: GoogleCredentials,
  fetcher: typeof fetch = fetch,
): GoogleTokenSource => {
  let token = "";
  let expiresAt = 0;
  return {
    token: async () => {
      if (token.length > 0 && Date.now() < expiresAt) return token;
      const minted = await mintAccessToken(credentials, fetcher);
      token = minted.token;
      expiresAt = minted.expiresAt;
      return token;
    },
  };
};

const mintAccessToken = async (
  credentials: GoogleCredentials,
  fetcher: typeof fetch,
): Promise<{ readonly token: string; readonly expiresAt: number; }> => {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token endpoint returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isJsonRecord(payload) || typeof payload["access_token"] !== "string") {
    throw new Error("Google token endpoint returned an invalid payload");
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
