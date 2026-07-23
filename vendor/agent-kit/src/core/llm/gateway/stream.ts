import * as Schema from "effect/Schema";
import * as Sse from "effect/unstable/encoding/Sse";
import { LlmError } from "../../errors.js";
import { ZERO_USAGE } from "../../types.js";
import {
  type ChatChunk,
  ChatChunkSchema,
  type StreamTurnResult,
  type ToolCall,
} from "../types.js";
import { mapUsage } from "../usage.js";
import type {
  StreamAccumulator,
  ToolAccumulator,
  ToolCallDelta,
} from "./types.js";

const SSE_DONE = "[DONE]";
const ZERO_MILLISECONDS = 0;
const decodeChatChunk = Schema.decodeUnknownPromise(
  Schema.fromJsonString(ChatChunkSchema),
);

export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
  startedAtMs: number,
): Promise<StreamTurnResult> {
  const state: StreamAccumulator = {
    textParts: [],
    tools: new Map(),
    ttftMs: ZERO_MILLISECONDS,
    finishReason: undefined,
    responseModel: fallbackModel,
    usageRaw: undefined,
  };
  // Effect's spec-complete SSE parser. LiteLLM emits one JSON `data:` line per
  // event, terminated by `data: [DONE]`; `feed` invokes the callback inline.
  const dataPayloads: string[] = [];
  let sawDone = false;
  const parser = Sse.makeParser((event) => {
    if (Sse.Retry.is(event)) return; // reconnect directive — LiteLLM never sends one
    if (event.data === SSE_DONE) sawDone = true;
    else dataPayloads.push(event.data);
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    for (const payload of dataPayloads) {
      applyChunk(state, await decodeStreamChunk(payload), startedAtMs);
    }
    dataPayloads.length = 0;
    if (sawDone) break;
  }
  return toStreamResult(state, startedAtMs);
}

async function decodeStreamChunk(event: string): Promise<ChatChunk> {
  try {
    return await decodeChatChunk(event);
  } catch (error) {
    throw new LlmError({
      message: `Invalid LiteLLM stream chunk: ${errorMessage(error)}`,
      kind: "protocol",
      cause: error,
    });
  }
}

function applyChunk(
  state: StreamAccumulator,
  chunk: ChatChunk,
  startedAtMs: number,
): void {
  applyMetadata(state, chunk);
  const delta = chunk.choices?.[0]?.delta;
  applyContent(state, delta?.content, startedAtMs);
  for (const toolCall of delta?.tool_calls ?? []) {
    applyToolDelta(state.tools, toolCall);
  }
}

function applyMetadata(state: StreamAccumulator, chunk: ChatChunk): void {
  if (chunk.model) state.responseModel = chunk.model;
  if (chunk.usage !== undefined) state.usageRaw = chunk.usage;
  const choice = chunk.choices?.[0];
  if (choice?.finish_reason) state.finishReason = choice.finish_reason;
}

function applyContent(
  state: StreamAccumulator,
  content: string | null | undefined,
  startedAtMs: number,
): void {
  if (!content) return;
  if (state.ttftMs === ZERO_MILLISECONDS) {
    state.ttftMs = performance.now() - startedAtMs;
  }
  state.textParts.push(content);
}

function applyToolDelta(
  tools: Map<number, ToolAccumulator>,
  delta: ToolCallDelta,
): void {
  const current = tools.get(delta.index) ?? { id: "", name: "", args: [] };
  if (delta.id) current.id = delta.id;
  if (delta.function?.name) current.name = delta.function.name;
  if (delta.function?.arguments) current.args.push(delta.function.arguments);
  tools.set(delta.index, current);
}

function toStreamResult(
  state: StreamAccumulator,
  startedAtMs: number,
): StreamTurnResult {
  const totalMs = performance.now() - startedAtMs;
  return {
    text: state.textParts.join(""),
    toolCalls: collectToolCalls(state.tools),
    finishReason: mapFinish(state.finishReason),
    responseModel: state.responseModel,
    usage: state.usageRaw ? mapUsage(state.usageRaw) : ZERO_USAGE,
    ttftMs: state.ttftMs || totalMs,
    totalMs,
  };
}

function collectToolCalls(
  tools: Map<number, ToolAccumulator>,
): ToolCall[] {
  return [...tools]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => ({
      id: value.id,
      name: value.name,
      arguments: value.args.join(""),
    }));
}

export function mapFinish(
  finishReason: string | undefined | null,
): StreamTurnResult["finishReason"] {
  switch (finishReason) {
    case "stop":
    case "tool_calls":
    case "length":
    case "content_filter": {
      return finishReason;
    }
    default: {
      return "stop";
    }
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
