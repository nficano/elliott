import { isJsonRecord, recordArray } from "../../providers/http";
import type {
  ModelMessage,
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
  ToolCall,
  ToolDefinition,
} from "../types";

const RESPONSE_DETAIL_MAX_CHARACTERS = 500;

export class RuntimeModelClient {
  readonly #settings: RuntimeSettings;

  constructor(settings: RuntimeSettings) {
    this.#settings = settings;
  }

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
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
          stream: false,
        }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(
        0,
        RESPONSE_DETAIL_MAX_CHARACTERS,
      );
      throw new Error(`LiteLLM ${response.status}: ${detail}`);
    }
    const payload: unknown = await response.json();
    return decodeCompletion(payload);
  }
}

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
  return {
    text: typeof content === "string" ? content : "",
    toolCalls: recordArray(message, "tool_calls").map(decodeToolCall),
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
