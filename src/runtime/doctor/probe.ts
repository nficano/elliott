import type {
  ModelTurnRequest,
  RuntimeModelCompleter,
  RuntimeSettings,
} from "../types";
import { originOf } from "./egress";
import { oneLine } from "./message";
import type { DoctorLlmProbe } from "./types";

// A deliberately trivial exchange: it proves the whole LLM path end to end
// (config → endpoint → wire → HTTP → auth → decode) with the cheapest possible
// generation. The reply content is irrelevant and is NOT surfaced — a well-
// formed completion coming back at all is the signal.
const PROBE_SYSTEM =
  "You are an elliott connectivity probe. Answer in one short word.";
const PROBE_PROMPT = "Reply with the single word: ready";

// HTTP status buckets. Common auth-rejection codes. The doctor reports one of
// these fixed phrases (a fact it derives from the status), never the provider's
// response body — which is endpoint-controlled and may quote credentials.
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;

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

// Turn any thrown model error into a fixed, self-derived classification. An
// error carrying a numeric `status` (ModelHttpError) is bucketed by that code;
// anything else (a network failure, a timeout, a decode error) is an
// unreachable/unresponsive endpoint. No caught message ever reaches the output.
const classifyFailure = (error: unknown): string => {
  const status = error !== null && typeof error === "object"
    ? (error as { status?: unknown; }).status
    : undefined;
  if (typeof status === "number") {
    return `${classifyStatus(status)} (HTTP ${status})`;
  }
  return "endpoint unreachable or did not respond";
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

// Exercise the configured model once. The result reports only facts the doctor
// derives itself — the wire, the endpoint origin, the model id, and a fixed
// failure classification. Nothing the endpoint controls (its response body, its
// reply text) is carried into the report. Metadata is flattened to one line so
// it cannot span lines; it needs no secret redaction because none of it is an
// endpoint-controlled value.
export const probeLlm = async (
  settings: RuntimeSettings,
  makeCompleter: (settings: RuntimeSettings) => RuntimeModelCompleter,
): Promise<DoctorLlmProbe> => {
  const endpoint = {
    wire: settings.llmWire,
    baseUrl: endpointOrigin(settings.llmBaseUrl),
    model: oneLine(settings.model),
  } as const;
  const request: ModelTurnRequest = {
    system: PROBE_SYSTEM,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    tools: [],
    allowTools: false,
  };
  try {
    await makeCompleter(settings).complete(request);
    return { ok: true, ...endpoint };
  } catch (error) {
    return { ok: false, ...endpoint, error: classifyFailure(error) };
  }
};
