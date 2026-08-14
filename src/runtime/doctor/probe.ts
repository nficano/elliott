import type {
  ModelTurnRequest,
  RuntimeModelCompleter,
  RuntimeSettings,
} from "../types";
import { originOf } from "./egress";
import { sanitizeForDisplay } from "./message";
import type { DoctorLlmProbe } from "./types";

// A deliberately trivial exchange: it proves the whole LLM path end to end
// (config → endpoint → wire → HTTP → auth → decode) and that a usable completion
// comes back. The reply CONTENT is never surfaced; only that a non-empty
// completion arrived is the signal.
const PROBE_SYSTEM =
  "You are an elliott connectivity probe. Answer in one short word.";
const PROBE_PROMPT = "Reply with the single word: ready";

// HTTP status buckets. The doctor reports one of these fixed phrases (a fact it
// derives from the status), never the provider's response body — which is
// endpoint-controlled and may quote credentials.
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;

// Fixed outcome phrases (a closed set this repo owns). Reachable-but-broken is
// distinct from unreachable, and an empty completion is its own outcome.
const UNREACHABLE = "endpoint unreachable or did not respond";
const UNREADABLE = "endpoint returned an unreadable response";
const EMPTY_COMPLETION = "endpoint returned an empty completion";

const classifyStatus = (status: number): string => {
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return "authentication rejected";
  }
  if (status === NOT_FOUND) return "model or endpoint not found";
  if (status === REQUEST_TIMEOUT) return "endpoint timed out";
  if (status === TOO_MANY_REQUESTS) return "rate limited";
  if (status >= SERVER_ERROR_MIN) return "endpoint server error";
  if (status >= CLIENT_ERROR_MIN) return "request rejected by the endpoint";
  return "unexpected response";
};

// Turn any thrown model error into a fixed, self-derived classification. A
// numeric `status` (ModelHttpError) is bucketed by that code; a `decode` marker
// (ModelDecodeError) is a reachable endpoint that returned garbage — distinct
// from an unreachable one; anything else is unreachable. No caught message ever
// reaches the output.
const classifyFailure = (error: unknown): string => {
  const record = error !== null && typeof error === "object"
    ? (error as { status?: unknown; decode?: unknown; })
    : {};
  if (typeof record.status === "number") {
    return `${classifyStatus(record.status)} (HTTP ${record.status})`;
  }
  if (record.decode === true) return UNREADABLE;
  return UNREACHABLE;
};

// The endpoint reduced to its ORIGIN (scheme://host:port). An origin cannot
// carry userinfo, a path, or a query, so it is credential-free by construction —
// a fact derived here, not a forwarded string that might embed inline
// credentials. A base URL that will not parse degrades to a fixed placeholder.
const endpointOrigin = (baseUrl: string): string => {
  try {
    return originOf(baseUrl);
  } catch {
    return "(unparseable endpoint)";
  }
};

// A base URL that will not parse as a URL. The probe cannot run — there is no
// origin to pin egress to and no endpoint to reach — so it is its own outcome,
// distinct from a reachable-but-broken one.
const INVALID_ENDPOINT = "endpoint is not a valid URL";

// The endpoint facts the doctor derives itself, each run through the secret
// sanitizer (`secrets` is the config boundary's recorded set): the wire, the
// endpoint ORIGIN (credential-free), and the model id. Nothing endpoint-controlled
// is carried here.
const endpointMetadata = (
  settings: RuntimeSettings,
  secrets: readonly string[],
): {
  readonly wire: string;
  readonly baseUrl: string;
  readonly model: string;
} => ({
  wire: settings.llmWire,
  baseUrl: sanitizeForDisplay(endpointOrigin(settings.llmBaseUrl), secrets),
  model: sanitizeForDisplay(settings.model, secrets),
});

// A failed probe for a base URL that does not parse. Rendered instead of letting
// the origin computation throw an unhandled TypeError that would carry the raw
// URL (which can embed inline credentials) to an outer error handler.
export const invalidEndpointProbe = (
  settings: RuntimeSettings,
  secrets: readonly string[],
): DoctorLlmProbe => ({
  ok: false,
  ...endpointMetadata(settings, secrets),
  error: INVALID_ENDPOINT,
});

// Exercise the configured model once. The result reports only facts the doctor
// derives itself — the wire, the endpoint origin, the model id, and a fixed
// outcome phrase. Nothing the endpoint controls (its response body, its reply
// text) is carried into the report. Metadata is run through the secret
// sanitizer (`secrets` is the config boundary's recorded set) so a credential
// that happens to be a resolved config value is scrubbed. PASS requires a
// non-empty completion — a fulfilled call alone is not success.
export const probeLlm = async (
  settings: RuntimeSettings,
  makeCompleter: (settings: RuntimeSettings) => RuntimeModelCompleter,
  secrets: readonly string[],
): Promise<DoctorLlmProbe> => {
  const endpoint = endpointMetadata(settings, secrets);
  const request: ModelTurnRequest = {
    system: PROBE_SYSTEM,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    tools: [],
    allowTools: false,
  };
  try {
    const result = await makeCompleter(settings).complete(request);
    if (result.text.trim().length === 0) {
      return { ok: false, ...endpoint, error: EMPTY_COMPLETION };
    }
    return { ok: true, ...endpoint };
  } catch (error) {
    return { ok: false, ...endpoint, error: classifyFailure(error) };
  }
};
