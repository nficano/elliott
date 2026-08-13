import { nestedRecord } from "../../../providers/http";
import type { ModelTurnResult } from "../../types";
import { parseStreamEvent, readServerEvents } from "../sse";
import type { AnthropicStreamState } from "../types";
import { tokenCount, usageOf, WIRE_NAME } from "./anthropic-protocol";

const blockIndex = (
  payload: Readonly<Record<string, unknown>>,
): number | undefined => {
  const index = payload["index"];
  return typeof index === "number" && Number.isSafeInteger(index)
    ? index
    : undefined;
};

const startBlock = (
  state: AnthropicStreamState,
  payload: Readonly<Record<string, unknown>>,
): void => {
  const block = nestedRecord(payload, "content_block");
  const index = blockIndex(payload);
  if (block === undefined || index === undefined) return;
  if (block["type"] !== "tool_use") return;
  const id = block["id"];
  const name = block["name"];
  if (typeof id !== "string" || typeof name !== "string") return;
  state.calls.set(index, { id, name, arguments: "" });
};

const applyDelta = async (
  state: AnthropicStreamState,
  payload: Readonly<Record<string, unknown>>,
  onTextDelta: (delta: string) => Promise<void>,
): Promise<void> => {
  const delta = nestedRecord(payload, "delta");
  if (delta === undefined) return;
  const text = delta["text"];
  if (delta["type"] === "text_delta" && typeof text === "string") {
    if (text.length === 0) return;
    state.text += text;
    await onTextDelta(text);
    return;
  }
  // `thinking_delta` is deliberately dropped: it is reasoning, not answer
  // text, and must never reach a user-facing stream.
  const partial = delta["partial_json"];
  if (delta["type"] !== "input_json_delta" || typeof partial !== "string") {
    return;
  }
  const index = blockIndex(payload);
  const call = index === undefined ? undefined : state.calls.get(index);
  if (call !== undefined) call.arguments += partial;
};

const streamError = (payload: Readonly<Record<string, unknown>>): Error => {
  const error = nestedRecord(payload, "error");
  const type = error?.["type"];
  const message = error?.["message"];
  const detail = typeof message === "string" ? `: ${message}` : "";
  const kind = typeof type === "string" ? type : "unknown";
  return new Error(`${WIRE_NAME} stream error: ${kind}${detail}`);
};

const recordInputTokens = (
  state: AnthropicStreamState,
  payload: Readonly<Record<string, unknown>>,
): void => {
  const message = nestedRecord(payload, "message");
  state.inputTokens = tokenCount(
    message === undefined ? undefined : nestedRecord(message, "usage"),
    "input_tokens",
  );
};

// Anthropic ends the stream by closing the body after message_stop; there is
// no [DONE] sentinel, so this never asks the reader to stop early.
const handleEvent = async (
  state: AnthropicStreamState,
  payload: Readonly<Record<string, unknown>>,
  onTextDelta: (delta: string) => Promise<void>,
): Promise<boolean> => {
  switch (payload["type"]) {
    case "error": {
      throw streamError(payload);
    }
    case "message_start": {
      recordInputTokens(state, payload);
      break;
    }
    case "content_block_start": {
      startBlock(state, payload);
      break;
    }
    case "content_block_delta": {
      await applyDelta(state, payload, onTextDelta);
      break;
    }
    case "message_delta": {
      state.outputTokens = tokenCount(
        nestedRecord(payload, "usage"),
        "output_tokens",
      );
      break;
    }
    // message_stop and ping carry nothing this decoder needs.
    default: {
      break;
    }
  }
  return false;
};

export const decodeAnthropicStream = async (
  response: Response,
  onTextDelta: (delta: string) => Promise<void>,
  onActivity?: () => void,
): Promise<ModelTurnResult> => {
  if (response.body === null) {
    throw new Error(`${WIRE_NAME} returned an empty stream`);
  }
  const state: AnthropicStreamState = {
    text: "",
    inputTokens: undefined,
    outputTokens: undefined,
    calls: new Map(),
  };
  await readServerEvents(
    response.body,
    onActivity,
    async (data) =>
      await handleEvent(state, parseStreamEvent(data, WIRE_NAME), onTextDelta),
  );
  const usage = usageOf(state.inputTokens, state.outputTokens);
  return {
    text: state.text,
    toolCalls: [...state.calls]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments.trim().length === 0 ? "{}" : call.arguments,
      })),
    ...(usage !== undefined && { usage }),
  };
};
