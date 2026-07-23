import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { IntegrationError } from "../../integrations/http.js";
import type { YoutubeApiDeps } from "./types.js";

/**
 * Shared request plumbing for the YouTube Data API v3: bearer-authenticated
 * GET/POST over the integrations http core, plus the `youtube.api` error
 * constructor for empty/short API answers.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
export const PAGE_SIZE = "50";

function apiUrl(path: string, query: Record<string, string>): string {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

export function apiGet<T>(request: {
  readonly deps: YoutubeApiDeps;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly schema: Schema.Decoder<T>;
}): Effect.Effect<T, IntegrationError> {
  return request.deps.auth.token().pipe(
    Effect.flatMap((token) =>
      request.deps.http.fetchJson(
        {
          url: apiUrl(request.path, request.query),
          headers: { authorization: `Bearer ${token}` },
        },
        request.schema,
      )
    ),
  );
}

export function apiPost<T>(request: {
  readonly deps: YoutubeApiDeps;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
  readonly schema: Schema.Decoder<T>;
}): Effect.Effect<T, IntegrationError> {
  return request.deps.auth.token().pipe(
    Effect.flatMap((token) =>
      request.deps.http.fetchJson(
        {
          url: apiUrl(request.path, request.query),
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request.body),
        },
        request.schema,
      )
    ),
  );
}

export function apiError(message: string): IntegrationError {
  return new IntegrationError({
    tag: "youtube.api",
    message: `youtube: ${message}`,
  });
}
