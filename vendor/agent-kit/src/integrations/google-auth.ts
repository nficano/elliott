import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createSign } from "node:crypto";
import { IntegrationError, makeHttp } from "./http.js";
import type {
  CachedToken,
  GoogleAuth,
  HttpClient,
  MakeGoogleAuthParams,
  ServiceAccountJson,
} from "./types.js";

/**
 * SDK-free Google service-account auth (CAPABILITIES-TDD §9.4): an RS256-signed
 * JWT assertion exchanged at the token endpoint, cached until shortly before
 * expiry. A missing/invalid SA JSON THROWS AT CONSTRUCTION — an unrecoverable
 * boot error must fail loudly, never silently target the wrong project.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_SKEW_SEC = 60;
const MILLISECONDS_PER_SECOND = 1000;
const TOKEN_TTL_SEC = 3600;

export function makeGoogleAuth(params: MakeGoogleAuthParams): GoogleAuth {
  const { sa, scope } = params;
  if (!sa.client_email || !sa.private_key) {
    throw new IntegrationError({
      tag: "google-auth.config",
      message: "service account JSON missing client_email/private_key",
    });
  }
  const http = makeHttp(
    "google-auth",
    params.fetchImpl ? { fetchImpl: params.fetchImpl } : {},
  );
  const now = params.now ?? (() => Date.now());

  let cached: CachedToken | undefined;

  return {
    clientEmail: sa.client_email,
    ...(sa.project_id && { projectId: sa.project_id }),
    token(): Effect.Effect<string, IntegrationError> {
      if (cached && now() < cached.expiresAtMs) {
        return Effect.succeed(cached.token);
      }
      return mintToken({
        sa,
        scope,
        http,
        now,
        cache: (token) => {
          cached = token;
        },
      });
    },
  };
}

function mintToken(params: {
  readonly sa: ServiceAccountJson;
  readonly scope: string;
  readonly http: HttpClient;
  readonly now: () => number;
  readonly cache: (token: CachedToken) => void;
}): Effect.Effect<string, IntegrationError> {
  const iat = Math.floor(params.now() / MILLISECONDS_PER_SECOND);
  const claims = {
    iss: params.sa.client_email,
    scope: params.scope,
    aud: TOKEN_URL,
    iat,
    exp: iat + TOKEN_TTL_SEC,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${
    b64url(JSON.stringify(claims))
  }`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(
    params.sa.private_key,
  );
  const assertion = `${unsigned}.${signature.toString("base64url")}`;
  return exchangeAssertion(params, assertion);
}

function exchangeAssertion(
  params: {
    readonly http: HttpClient;
    readonly now: () => number;
    readonly cache: (token: CachedToken) => void;
  },
  assertion: string,
): Effect.Effect<string, IntegrationError> {
  return params.http
    .fetchJson({
      url: TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    }, TokenResponse)
    .pipe(Effect.map((json) => {
      const token = json.access_token ?? "";
      const ttlSec = json.expires_in ?? TOKEN_TTL_SEC;
      params.cache({
        token,
        expiresAtMs: params.now()
          + (ttlSec - TOKEN_SKEW_SEC) * MILLISECONDS_PER_SECOND,
      });
      return token;
    }));
}

const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
});

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
