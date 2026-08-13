import { isJsonRecord } from "../../providers/http";

// Server-sent-event framing shared by every wire. Both OpenAI-compatible and
// Anthropic endpoints stream `data:` lines in \n\n-delimited frames; only the
// payload shape and the end-of-stream signal differ, so the handler decides
// when to stop by returning true.
export const readServerEvents = async (
  body: ReadableStream<Uint8Array>,
  onActivity: (() => void) | undefined,
  onData: (data: string) => Promise<boolean>,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const next = await reader.read();
    onActivity?.();
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
  onData: (data: string) => Promise<boolean>,
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
  onData: (data: string) => Promise<boolean>,
): Promise<boolean> => {
  const data = event.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (data.length === 0) return false;
  return await onData(data);
};

export const parseStreamEvent = (
  data: string,
  wire: string,
): Readonly<Record<string, unknown>> => {
  const value: unknown = JSON.parse(data);
  if (!isJsonRecord(value)) {
    throw new Error(`${wire} returned a non-object stream event`);
  }
  return value;
};
