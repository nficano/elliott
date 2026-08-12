import { hashValue } from "../../core/digest";
import { isJsonRecord, recordArray } from "../../providers/http";
import type {
  ModelCallTimeouts,
  ModelCallWatchdog,
  ModelMessage,
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
  ToolCall,
  ToolDefinition,
} from "../types";
import { decodeCompletionStream } from "./stream";
import { decodeRuntimeModelUsage } from "./usage";

const RESPONSE_DETAIL_MAX_CHARACTERS = 500;
const MILLISECONDS_PER_SECOND = 1000;

// A hung LiteLLM call used to fail only at Bun's opaque default fetch
// deadline (~300s, surfacing as a bare TimeoutError in the turn). The
// watchdog bounds *inactivity* instead of total time: the initial window
// covers time-to-first-byte (a non-streaming completion generates fully
// before answering), and every streamed chunk then resets a shorter gap
// allowance — so long healthy generations are never cut while a stalled
// upstream fails in bounded time with a nameable error.
const INITIAL_RESPONSE_TIMEOUT_MILLISECONDS = 240_000;
const STREAM_INACTIVITY_TIMEOUT_MILLISECONDS = 90_000;

const DEFAULT_TIMEOUTS: ModelCallTimeouts = {
  initialMilliseconds: INITIAL_RESPONSE_TIMEOUT_MILLISECONDS,
  inactivityMilliseconds: STREAM_INACTIVITY_TIMEOUT_MILLISECONDS,
};

export class RuntimeModelClient {
  readonly #settings: RuntimeSettings;
  readonly #timeouts: ModelCallTimeouts;

  constructor(
    settings: RuntimeSettings,
    timeouts: ModelCallTimeouts = DEFAULT_TIMEOUTS,
  ) {
    this.#settings = settings;
    this.#timeouts = timeouts;
  }

  async complete(
    request: ModelTurnRequest,
    onTextDelta?: (delta: string) => Promise<void>,
  ): Promise<ModelTurnResult> {
    const watchdog = startWatchdog(this.#timeouts);
    try {
      return await this.#request(request, onTextDelta, watchdog);
    } catch (error) {
      // Bun may surface an abort as its own AbortError; the watchdog's
      // reason names the stall, so prefer it.
      throw watchdog.signal.aborted ? watchdog.signal.reason : error;
    } finally {
      watchdog.stop();
    }
  }

  async #request(
    request: ModelTurnRequest,
    onTextDelta: ((delta: string) => Promise<void>) | undefined,
    watchdog: ModelCallWatchdog,
  ): Promise<ModelTurnResult> {
    const streaming = onTextDelta !== undefined;
    const response = await fetch(
      `${this.#settings.llmBaseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#settings.llmApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#settings.model,
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map(wireMessage),
          ],
          tools: request.tools.map(wireTool),
          tool_choice: request.allowTools ? "auto" : "none",
          max_tokens: this.#settings.maxTokens,
          temperature: this.#settings.temperature,
          stream: streaming,
          ...(streaming && { stream_options: { include_usage: true } }),
        }),
        signal: watchdog.signal,
      },
    );
    watchdog.touch();
    if (!response.ok) {
      const detail = (await response.text()).slice(
        0,
        RESPONSE_DETAIL_MAX_CHARACTERS,
      );
      throw new Error(`LiteLLM ${response.status}: ${detail}`);
    }
    const result = onTextDelta === undefined
      ? decodeCompletion(await response.json())
      : await decodeCompletionStream(response, onTextDelta, watchdog.touch);
    return this.#attest(result);
  }

  #attest(result: ModelTurnResult): ModelTurnResult {
    const routeDigest = hashValue({
      baseUrl: this.#settings.llmBaseUrl,
      model: this.#settings.model,
    });
    return {
      ...result,
      selection: {
        routeDigest,
        usageReference: hashValue({
          routeDigest,
          usage: result.usage ?? null,
          response: hashValue({
            text: result.text,
            toolCalls: result.toolCalls,
          }),
        }),
      },
    };
  }
}

const startWatchdog = (timeouts: ModelCallTimeouts): ModelCallWatchdog => {
  const controller = new AbortController();
  let waitMilliseconds = timeouts.initialMilliseconds;
  const expire = (): void => {
    const seconds = Math.round(waitMilliseconds / MILLISECONDS_PER_SECOND);
    controller.abort(
      new Error(`LiteLLM stalled: no data for ${seconds}s`),
    );
  };
  let timer = setTimeout(expire, waitMilliseconds);
  return {
    signal: controller.signal,
    touch: (): void => {
      clearTimeout(timer);
      waitMilliseconds = timeouts.inactivityMilliseconds;
      timer = setTimeout(expire, waitMilliseconds);
    },
    stop: (): void => {
      clearTimeout(timer);
    },
  };
};

const wireTool = (tool: ToolDefinition) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
});

const wireMessage = (
  message: ModelMessage,
): Readonly<Record<string, unknown>> => {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId ?? "unknown",
    };
  }
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls !== undefined
      && { tool_calls: message.toolCalls.map(wireToolCall) }),
  };
};

const wireToolCall = (call: ToolCall) => ({
  id: call.id,
  type: "function",
  function: { name: call.name, arguments: call.arguments },
});

const decodeCompletion = (payload: unknown): ModelTurnResult => {
  if (!isJsonRecord(payload)) throw new Error("LiteLLM returned invalid JSON");
  const choice = recordArray(payload, "choices")[0];
  const message = choice?.["message"];
  if (!isJsonRecord(message)) throw new Error("LiteLLM returned no message");
  const content = message["content"];
  const usage = decodeRuntimeModelUsage(payload);
  return {
    text: typeof content === "string" ? content : "",
    toolCalls: recordArray(message, "tool_calls").map(decodeToolCall),
    ...(usage !== undefined && { usage }),
  };
};

const decodeToolCall = (
  value: Readonly<Record<string, unknown>>,
): ToolCall => {
  const id = value["id"];
  const fn = value["function"];
  if (typeof id !== "string" || !isJsonRecord(fn)) {
    throw new Error("LiteLLM returned an invalid tool call");
  }
  const name = fn["name"];
  const argumentsValue = fn["arguments"];
  if (typeof name !== "string" || typeof argumentsValue !== "string") {
    throw new TypeError("LiteLLM returned invalid tool arguments");
  }
  return { id, name, arguments: argumentsValue };
};
