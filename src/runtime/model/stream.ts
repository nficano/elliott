import { nestedRecord, recordArray } from "../../providers/http";
import type { ModelTurnResult, RuntimeModelUsage, ToolCall } from "../types";
import { parseStreamEvent, readServerEvents } from "./sse";
import { decodeRuntimeModelUsage } from "./usage";

const WIRE_NAME = "OpenAI-compatible";

export const decodeCompletionStream = async (
  response: Response,
  onTextDelta: (delta: string) => Promise<void>,
  onActivity?: () => void,
): Promise<ModelTurnResult> => {
  if (response.body === null) {
    throw new Error(`${WIRE_NAME} returned an empty stream`);
  }
  let text = "";
  let usage: RuntimeModelUsage | undefined;
  const calls = new Map<
    number,
    { id: string; name: string; arguments: string; }
  >();
  await readServerEvents(response.body, onActivity, async (data) => {
    if (data === "[DONE]") return true;
    const payload = parseStreamEvent(data, WIRE_NAME);
    usage = decodeRuntimeModelUsage(payload) ?? usage;
    const choice = recordArray(payload, "choices")[0];
    const delta = choice === undefined
      ? undefined
      : nestedRecord(choice, "delta");
    if (delta === undefined) return false;
    const content = delta["content"];
    if (typeof content === "string" && content.length > 0) {
      text += content;
      await onTextDelta(content);
    }
    collectToolCalls(delta, calls);
    return false;
  });
  return {
    text,
    toolCalls: [...calls]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => completeToolCall(call)),
    ...(usage !== undefined && { usage }),
  };
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
    throw new Error(`${WIRE_NAME} returned an incomplete streamed tool call`);
  }
  return call;
};
