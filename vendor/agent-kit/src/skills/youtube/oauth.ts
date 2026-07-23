import * as Effect from "effect/Effect";
import type { IntegrationError } from "../../integrations/http.js";
import { makeHttp } from "../../integrations/http.js";
import type { CachedToken, HttpClient } from "../../integrations/types.js";
import { TokenResponseSchema } from "./schema.js";
import type { MakeYoutubeAuthParams, YoutubeAuth } from "./types.js";

/**
 * Refresh-token OAuth for the YouTube Data API — the port of run.py's
 * `get_access_token`: exchange the long-lived, user-consented refresh token
 * at Google's token endpoint and cache the short-lived access token in
 * memory until shortly before expiry (55 of the nominal 60 minutes, matching
 * run.py's 3300 s Redis TTL). Distinct from `integrations/google-auth`,
 * which implements the service-account JWT-assertion flow — playlist
 * mutations need a user grant, not a service account.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_TTL_SECONDS = 3600;
/** 3600 − 300 = run.py's 3300 s (55 min) cache lifetime. */
const TTL_LEEWAY_SECONDS = 300;

export function makeYoutubeAuth(params: MakeYoutubeAuthParams): YoutubeAuth {
  const http = makeHttp(
    "youtube-auth",
    params.fetchImpl ? { fetchImpl: params.fetchImpl } : {},
  );
  const now = params.now ?? (() => Date.now());
  let cached: CachedToken | undefined;
  return {
    token(): Effect.Effect<string, IntegrationError> {
      if (cached && now() < cached.expiresAtMs) {
        return Effect.succeed(cached.token);
      }
      return refreshAccessToken({
        params,
        http,
        now,
        cache: (token) => {
          cached = token;
        },
      });
    },
  };
}

function refreshAccessToken(deps: {
  readonly params: MakeYoutubeAuthParams;
  readonly http: HttpClient;
  readonly now: () => number;
  readonly cache: (token: CachedToken) => void;
}): Effect.Effect<string, IntegrationError> {
  return deps.http.fetchJson(
    {
      url: TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: deps.params.clientId,
        client_secret: deps.params.clientSecret,
        refresh_token: deps.params.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    },
    TokenResponseSchema,
  ).pipe(
    Effect.map((json) => {
      const ttlSeconds = (json.expires_in ?? DEFAULT_TTL_SECONDS)
        - TTL_LEEWAY_SECONDS;
      deps.cache({
        token: json.access_token,
        expiresAtMs: deps.now() + ttlSeconds * MILLISECONDS_PER_SECOND,
      });
      return json.access_token;
    }),
  );
}
