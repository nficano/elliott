import { isJsonRecord, recordArray } from "../../../providers/http";
import type {
  ModelMessage,
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
  ToolCall,
  ToolDefinition,
} from "../../types";
import { decodeCompletionStream } from "../stream";
import type { ModelWire, ModelWireRequest } from "../types";
import { decodeRuntimeModelUsage } from "../usage";

// Named for the protocol, not a vendor: this same wire serves a LiteLLM
// proxy, Ollama, OpenAI itself, and anything else exposing /chat/completions.
const WIRE_NAME = "OpenAI-compatible";

const wireTool = (tool: ToolDefinition) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
});

const wireToolCall = (call: ToolCall) => ({
  id: call.id,
  type: "function",
  function: { name: call.name, arguments: call.arguments },
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

const request = (
  settings: RuntimeSettings,
  turn: ModelTurnRequest,
  streaming: boolean,
): ModelWireRequest => ({
  url: `${settings.llmBaseUrl.replace(/\/$/, "")}/chat/completions`,
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${settings.llmApiKey}`,
  },
  body: {
    model: settings.model,
    messages: [
      { role: "system", content: turn.system },
      ...turn.messages.map(wireMessage),
    ],
    tools: turn.tools.map(wireTool),
    tool_choice: turn.allowTools ? "auto" : "none",
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    // Only sent when explicitly configured: endpoints that predate reasoning
    // models (and some proxies) reject unknown request fields outright.
    ...(settings.effort !== undefined
      && { reasoning_effort: settings.effort }),
    stream: streaming,
    ...(streaming && { stream_options: { include_usage: true } }),
  },
});

const decodeToolCall = (
  value: Readonly<Record<string, unknown>>,
): ToolCall => {
  const id = value["id"];
  const fn = value["function"];
  if (typeof id !== "string" || !isJsonRecord(fn)) {
    throw new Error(`${WIRE_NAME} returned an invalid tool call`);
  }
  const name = fn["name"];
  const argumentsValue = fn["arguments"];
  if (typeof name !== "string" || typeof argumentsValue !== "string") {
    throw new TypeError(`${WIRE_NAME} returned invalid tool arguments`);
  }
  return { id, name, arguments: argumentsValue };
};

const decode = (payload: unknown): ModelTurnResult => {
  if (!isJsonRecord(payload)) {
    throw new Error(`${WIRE_NAME} returned invalid JSON`);
  }
  const choice = recordArray(payload, "choices")[0];
  const message = choice?.["message"];
  if (!isJsonRecord(message)) {
    throw new Error(`${WIRE_NAME} returned no message`);
  }
  const content = message["content"];
  const usage = decodeRuntimeModelUsage(payload);
  return {
    text: typeof content === "string" ? content : "",
    toolCalls: recordArray(message, "tool_calls").map(decodeToolCall),
    ...(usage !== undefined && { usage }),
  };
};

export const openaiWire: ModelWire = {
  name: WIRE_NAME,
  request,
  decode,
  decodeStream: decodeCompletionStream,
};
