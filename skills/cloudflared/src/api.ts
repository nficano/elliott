import { isJsonRecord } from "../../../src/providers/http";
import type {
  CloudflareApi,
  CloudflareCredentials,
  CloudflareResult,
} from "./types";

const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;

// Cloudflare's error payload is an array of {code, message}. The MESSAGE is not
// forwarded: it echoes request context (hostname, account id, sometimes the
// record body) and this runtime prints only phrases it derives. The numeric
// code is Cloudflare's own stable identifier and is safe and useful — it is
// what an operator searches for.
const derivedReason = (status: number, body: unknown): string => {
  const codes = isJsonRecord(body) && Array.isArray(body["errors"])
    ? body["errors"].flatMap((entry) =>
      isJsonRecord(entry) && typeof entry["code"] === "number"
        ? [entry["code"]]
        : []
    )
    : [];
  return codes.length > 0
    ? `Cloudflare API returned HTTP ${status} (code ${codes.join(", ")})`
    : `Cloudflare API returned HTTP ${status}`;
};

// A request bound to one set of credentials. The token rides in the header and
// nowhere else — not in the URL, not in an error, not in a thrown message.
export const cloudflareApi = (
  credentials: CloudflareCredentials,
  fetchImpl: typeof fetch = fetch,
): CloudflareApi => ({
  request: async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<CloudflareResult> => {
    let response: Response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${credentials.apiToken}`,
          "content-type": "application/json",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      // Never the fetch error's text: it embeds the URL, which carries the
      // account and zone identifiers.
      return {
        success: false,
        result: undefined,
        reason: "Cloudflare API unreachable",
      };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        success: false,
        result: undefined,
        reason:
          `Cloudflare API returned an unreadable body (HTTP ${response.status})`,
      };
    }
    if (!response.ok || !isJsonRecord(parsed) || parsed["success"] !== true) {
      return {
        success: false,
        result: undefined,
        reason: derivedReason(response.status, parsed),
      };
    }
    return { success: true, result: parsed["result"] };
  },
});
