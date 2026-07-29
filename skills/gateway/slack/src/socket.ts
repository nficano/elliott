import { isJsonRecord } from "../../../../src/providers/http";
import type { SlackJson, SlackSocket, SlackSocketHandlers } from "./types";

const RETRY_DELAY_MILLISECONDS = 3000;
const MESSAGE_CHUNK_CHARACTERS = 11_500;

export const openSlackSocket = (
  url: string,
  handlers: SlackSocketHandlers,
): Promise<SlackSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () =>
      resolve({
        send: (value) => socket.send(value),
        close: () => socket.close(),
      }));
    socket.addEventListener("message", (event) =>
      handlers.onMessage(String(event.data)));
    socket.addEventListener("close", handlers.onClose);
    socket.addEventListener("error", () =>
      reject(new Error("Slack socket failed")));
  });

export const parseSlackFrame = (raw: string): SlackJson | undefined => {
  try {
    const frame: unknown = JSON.parse(raw);
    return isJsonRecord(frame) ? frame : undefined;
  } catch {
    return undefined;
  }
};

export const chunkSlackText = (text: string): readonly string[] => {
  if (text.length <= MESSAGE_CHUNK_CHARACTERS) return [text];
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < text.length;
    offset += MESSAGE_CHUNK_CHARACTERS
  ) {
    chunks.push(text.slice(offset, offset + MESSAGE_CHUNK_CHARACTERS));
  }
  return chunks;
};

export const waitBeforeSlackReconnect = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MILLISECONDS));
