import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../providers/http";
import type {
  ModelMessage,
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
  ToolCall,
  ToolDefinition,
} from "../../types";
import type { ModelWire, ModelWireRequest } from "../types";
import {
  ANTHROPIC_VERSION,
  tokenCount,
  usageOf,
  WIRE_NAME,
} from "./anthropic-protocol";
import { decodeAnthropicStream } from "./anthropic-stream";

const parseArguments = (raw: string): Readonly<Record<string, unknown>> => {
  if (raw.trim().length === 0) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isJsonRecord(value) ? value : {};
  } catch {
    return {};
  }
};

const assistantBlocks = (
  message: ModelMessage,
): readonly Readonly<Record<string, unknown>>[] => [
  ...(message.content.length > 0
    ? [{ type: "text", text: message.content }]
    : []),
  ...(message.toolCalls ?? []).map((call) => ({
    type: "tool_use",
    id: call.id,
    name: call.name,
    input: parseArguments(call.arguments),
  })),
];

const messageBlocks = (
  message: ModelMessage,
): readonly Readonly<Record<string, unknown>>[] => {
  if (message.role === "tool") {
    return [{
      type: "tool_result",
      tool_use_id: message.toolCallId ?? "unknown",
      content: message.content,
    }];
  }
  if (message.role === "assistant") return assistantBlocks(message);
  return message.content.length > 0
    ? [{ type: "text", text: message.content }]
    : [];
};

// Anthropic takes alternating user/assistant turns, and every tool_result for
// one parallel batch must ride in a SINGLE user turn — elliott models each
// result as its own message, so consecutive same-role turns are merged here.
// Emitting one message per result is a 400.
const encodeMessages = (
  messages: readonly ModelMessage[],
): readonly Readonly<Record<string, unknown>>[] => {
  const turns: { role: string; content: Record<string, unknown>[]; }[] = [];
  for (const message of messages) {
    const blocks = messageBlocks(message);
    if (blocks.length === 0) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const last = turns.at(-1);
    if (last?.role === role) {
      last.content.push(...blocks);
      continue;
    }
    turns.push({ role, content: [...blocks] });
  }
  return turns;
};

const encodeTool = (tool: ToolDefinition) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
});

const request = (
  settings: RuntimeSettings,
  turn: ModelTurnRequest,
  streaming: boolean,
): ModelWireRequest => ({
  url: `${settings.llmBaseUrl.replace(/\/$/, "")}/messages`,
  headers: {
    "content-type": "application/json",
    "x-api-key": settings.llmApiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  },
  body: {
    model: settings.model,
    max_tokens: settings.maxTokens,
    // No temperature/top_p/top_k: current Anthropic models removed the
    // sampling parameters and reject any of them with a 400. Steering here
    // is the system prompt's job.
    ...(turn.system.length > 0 && { system: turn.system }),
    messages: encodeMessages(turn.messages),
    ...(turn.tools.length > 0 && {
      tools: turn.tools.map(encodeTool),
      tool_choice: { type: turn.allowTools ? "auto" : "none" },
    }),
    // Unset means the model's own default. Note the provider rejects
    // disabled thinking above `high` effort on current models — that pairing
    // is surfaced as its 400 rather than second-guessed here, since the rule
    // is per-model and would rot if encoded.
    ...(settings.thinking !== undefined
      && { thinking: { type: settings.thinking } }),
    ...(settings.effort !== undefined
      && { output_config: { effort: settings.effort } }),
    ...(streaming && { stream: true }),
  },
});

const decodeToolUse = (
  block: Readonly<Record<string, unknown>>,
): ToolCall | undefined => {
  const id = block["id"];
  const name = block["name"];
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  const input = block["input"];
  return {
    id,
    name,
    arguments: JSON.stringify(isJsonRecord(input) ? input : {}),
  };
};

const decode = (payload: unknown): ModelTurnResult => {
  if (!isJsonRecord(payload)) {
    throw new Error(`${WIRE_NAME} returned invalid JSON`);
  }
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of recordArray(payload, "content")) {
    // `thinking` blocks are reasoning, not the answer — never concatenated
    // into user-visible text.
    if (block["type"] === "text" && typeof block["text"] === "string") {
      text += block["text"];
    }
    if (block["type"] === "tool_use") {
      const call = decodeToolUse(block);
      if (call !== undefined) toolCalls.push(call);
    }
  }
  const usage = usageOf(
    tokenCount(nestedRecord(payload, "usage"), "input_tokens"),
    tokenCount(nestedRecord(payload, "usage"), "output_tokens"),
  );
  return { text, toolCalls, ...(usage !== undefined && { usage }) };
};

export const anthropicWire: ModelWire = {
  name: WIRE_NAME,
  request,
  decode,
  decodeStream: decodeAnthropicStream,
};
