import { isJsonRecord } from "../../../src/providers/http";
import type { TokenStore, UsageClient } from "./types";

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const HTTP_UNAUTHORIZED = 401;

export const httpGet = (
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> =>
  fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

export const postJson = async (
  url: string,
  body: unknown,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed with HTTP ${response.status}`);
  }
  return response.json();
};

// The shared subscription-usage call shape: run the request with the newest
// tokens (persisted rotation wins over the Vault seed), refresh once on an
// expired or rejected token, and persist rotated tokens BEFORE retrying —
// OpenAI refresh tokens are single-use, so losing a rotation locks the
// account out until it is re-seeded.
export const fetchWithRefresh = async (
  client: UsageClient,
  store: TokenStore,
): Promise<unknown> => {
  let tokens = await store.load(client.key, client.seed);
  if (client.expired?.(tokens) === true) {
    tokens = await client.refresh(tokens);
    await store.save(client.key, client.seed, tokens);
  }
  let response = await client.request(tokens);
  if (response.status === HTTP_UNAUTHORIZED) {
    tokens = await client.refresh(tokens);
    await store.save(client.key, client.seed, tokens);
    response = await client.request(tokens);
  }
  if (!response.ok) {
    throw new Error(`${client.label} returned HTTP ${response.status}`);
  }
  return response.json();
};

export const stringField = (
  value: unknown,
  key: string,
): string | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
};

export const numberField = (
  value: unknown,
  key: string,
): number | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field)
    ? field
    : undefined;
};
