import { isJsonRecord, nestedRecord, recordArray } from "../../providers/http";
import type { ModelTurnResult, ToolCall } from "../types";

export const decodeCompletionStream = async (
  response: Response,
  onTextDelta: (delta: string) => Promise<void>,
): Promise<ModelTurnResult> => {
  if (response.body === null) {
    throw new Error("LiteLLM returned an empty stream");
  }
  let text = "";
  const calls = new Map<
    number,
    { id: string; name: string; arguments: string; }
  >();
  await readServerEvents(response.body, async (data) => {
    if (data === "[DONE]") return;
    const payload = parseEvent(data);
    const choice = recordArray(payload, "choices")[0];
    const delta = choice === undefined
      ? undefined
      : nestedRecord(choice, "delta");
    if (delta === undefined) return;
    const content = delta["content"];
    if (typeof content === "string" && content.length > 0) {
      text += content;
      await onTextDelta(content);
    }
    collectToolCalls(delta, calls);
  });
  return {
    text,
    toolCalls: [...calls]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => completeToolCall(call)),
  };
};

const readServerEvents = async (
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => Promise<void>,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const next = await reader.read();
    buffer += decoder.decode(next.value, { stream: !next.done });
    buffer = buffer.replaceAll("\r\n", "\n");
    const parsed = await consumeEvents(buffer, onData);
    buffer = parsed.remainder;
    if (next.done || parsed.done) break;
  }
  if (buffer.trim().length > 0) {
    await dispatchEvent(buffer, onData);
  }
};

const consumeEvents = async (
  input: string,
  onData: (data: string) => Promise<void>,
): Promise<{ readonly remainder: string; readonly done: boolean; }> => {
  let remainder = input;
  for (;;) {
    const boundary = remainder.indexOf("\n\n");
    if (boundary === -1) return { remainder, done: false };
    const event = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    if (await dispatchEvent(event, onData)) {
      return { remainder: "", done: true };
    }
  }
};

const dispatchEvent = async (
  event: string,
  onData: (data: string) => Promise<void>,
): Promise<boolean> => {
  const data = event.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (data.length === 0) return false;
  await onData(data);
  return data === "[DONE]";
};

const parseEvent = (data: string): Readonly<Record<string, unknown>> => {
  const value: unknown = JSON.parse(data);
  if (!isJsonRecord(value)) {
    throw new Error("LiteLLM returned a non-object stream event");
  }
  return value;
};

const collectToolCalls = (
  delta: Readonly<Record<string, unknown>>,
  calls: Map<number, { id: string; name: string; arguments: string; }>,
): void => {
  for (const fragment of recordArray(delta, "tool_calls")) {
    const index = fragment["index"];
    if (typeof index !== "number" || !Number.isSafeInteger(index)) continue;
    const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
    const fn = nestedRecord(fragment, "function");
    calls.set(index, {
      id: appendString(current.id, fragment["id"]),
      name: appendString(current.name, fn?.["name"]),
      arguments: appendString(current.arguments, fn?.["arguments"]),
    });
  }
};

const appendString = (current: string, value: unknown): string =>
  typeof value === "string" ? current + value : current;

const completeToolCall = (call: {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}): ToolCall => {
  if (call.id.length === 0 || call.name.length === 0) {
    throw new Error("LiteLLM returned an incomplete streamed tool call");
  }
  return call;
};
