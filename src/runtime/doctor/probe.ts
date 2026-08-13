import type {
  ModelTurnRequest,
  RuntimeModelCompleter,
  RuntimeSettings,
} from "../types";
import { cleanMessage } from "./message";
import type { DoctorLlmProbe } from "./types";

const PROBE_REPLY_MAX_CHARACTERS = 200;

// A deliberately trivial exchange: it proves the whole LLM path end to end
// (config → endpoint → wire → HTTP → auth → decode) with the cheapest possible
// generation. The reply content is irrelevant; that a well-formed completion
// comes back at all is the signal.
const PROBE_SYSTEM =
  "You are an elliott connectivity probe. Answer in one short word.";
const PROBE_PROMPT = "Reply with the single word: ready";

// Exercise the configured model once. On any failure — a wrong key, an
// unreachable endpoint, a rejected model — the model client throws an Error
// whose message already names the problem (e.g. "anthropic 401: ...").
// cleanMessage keeps that message and drops the stack.
export const probeLlm = async (
  settings: RuntimeSettings,
  makeCompleter: (settings: RuntimeSettings) => RuntimeModelCompleter,
): Promise<DoctorLlmProbe> => {
  const endpoint = {
    wire: settings.llmWire,
    baseUrl: settings.llmBaseUrl,
    model: settings.model,
  } as const;
  const request: ModelTurnRequest = {
    system: PROBE_SYSTEM,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    tools: [],
    allowTools: false,
  };
  try {
    const result = await makeCompleter(settings).complete(request);
    return {
      ok: true,
      ...endpoint,
      reply: result.text.slice(0, PROBE_REPLY_MAX_CHARACTERS),
    };
  } catch (error) {
    return { ok: false, ...endpoint, error: cleanMessage(error) };
  }
};
