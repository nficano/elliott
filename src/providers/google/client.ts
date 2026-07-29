import { isJsonRecord } from "../http";
import type {
  GoogleClient,
  GoogleClientOptions,
  GoogleJson,
  GoogleRequestSpec,
  GoogleTokenSource,
} from "./types";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const RATE_LIMITED = 429;
const SERVER_ERROR_FLOOR = 500;
const NO_CONTENT = 204;

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// A Google REST client with Bearer auth and bounded retry on 429/5xx (Google
// returns these for rate/quota limits), honoring Retry-After. `fetcher`/`sleep`
// are injectable for tests.
export const createGoogleClient = (
  source: GoogleTokenSource,
  options: GoogleClientOptions = {},
): GoogleClient => {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  return {
    request: (spec) => runRequest(source, fetcher, sleep, spec),
  };
};

const runRequest = async (
  source: GoogleTokenSource,
  fetcher: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
  spec: GoogleRequestSpec,
): Promise<GoogleJson> => {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetcher(spec.url, {
      method: spec.method,
      headers: {
        authorization: `Bearer ${await source.token()}`,
        ...(spec.body !== undefined && {
          "content-type": "application/json",
        }),
      },
      ...(spec.body !== undefined && { body: JSON.stringify(spec.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return parseBody(response);
    lastStatus = response.status;
    if (!retriable(response.status) || attempt === MAX_RETRIES) {
      throw new Error(`Google API returned HTTP ${response.status}`);
    }
    await sleep(backoff(response, attempt));
  }
  throw new Error(`Google API returned HTTP ${lastStatus}`);
};

const parseBody = async (response: Response): Promise<GoogleJson> => {
  if (response.status === NO_CONTENT) return {};
  const payload: unknown = await response.json().catch(() => ({}));
  return isJsonRecord(payload) ? payload : {};
};

const retriable = (status: number): boolean =>
  status === RATE_LIMITED || status >= SERVER_ERROR_FLOOR;

const backoff = (response: Response, attempt: number): number => {
  const header = response.headers.get("retry-after");
  const retryAfter = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(retryAfter)) return retryAfter * 1000;
  return BASE_BACKOFF_MS * 2 ** attempt;
};
