import { isJsonRecord } from "../../../src/providers/http";
import type { McpEndpointSettings } from "../../../src/runtime/types";
import { unwrapRpc } from "./http";
import type { PendingCall, PendingRpc, RpcWire, SseEvent } from "./types";

const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const EVENT_SEPARATOR = /\r?\n\r?\n/;
const EVENT_PREFIX = "event:";
const DATA_PREFIX = "data:";

export const makeSseWire = (settings: McpEndpointSettings): RpcWire => {
  const controller = new AbortController();
  const pending = new Map<number, PendingRpc>();
  let endpoint: string | undefined;
  let nextId = 1;
  return {
    start: async () => {
      endpoint = await openStream(settings, controller, pending);
    },
    request: async (method, params) => {
      if (endpoint === undefined) throw new Error("MCP SSE wire is not open");
      const id = nextId++;
      const answer = expectResponse(pending, {
        endpoint: settings.id,
        id,
        method,
      });
      await postRpc(settings, endpoint, {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      });
      return answer;
    },
    notify: async (method) => {
      if (endpoint === undefined) throw new Error("MCP SSE wire is not open");
      await postRpc(settings, endpoint, { jsonrpc: "2.0", method });
    },
    close: async () => {
      controller.abort();
      failPending(settings.id, pending, "connection closed");
    },
  };
};

const openStream = async (
  settings: McpEndpointSettings,
  controller: AbortController,
  pending: Map<number, PendingRpc>,
): Promise<string> => {
  const response = await fetch(settings.url, {
    headers: {
      accept: "text/event-stream",
      ...(settings.authorization !== undefined
        && { authorization: `Bearer ${settings.authorization}` }),
    },
    signal: controller.signal,
  });
  const body = response.body;
  if (!response.ok || body === null) {
    throw new Error(`MCP ${settings.id} SSE returned HTTP ${response.status}`);
  }
  return new Promise<string>((resolve, reject) => {
    void pump(body, (event) => {
      if (event.event === "endpoint") {
        resolve(new URL(event.data, settings.url).href);
        return;
      }
      settlePending(settings.id, pending, event.data);
    }).then(() => {
      failPending(settings.id, pending, "SSE stream closed");
      reject(new Error(`MCP ${settings.id} SSE stream closed`));
    }).catch((error: unknown) => {
      const failure = error instanceof Error
        ? error
        : new Error(String(error));
      failPending(settings.id, pending, failure.message);
      reject(failure);
    });
  });
};

const postRpc = async (
  settings: McpEndpointSettings,
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.authorization !== undefined
        && { authorization: `Bearer ${settings.authorization}` }),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`MCP ${settings.id} RPC returned HTTP ${response.status}`);
  }
  await response.body?.cancel();
};

const expectResponse = (
  pending: Map<number, PendingRpc>,
  call: PendingCall,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(call.id)) return;
      reject(new Error(`MCP ${call.endpoint} ${call.method} timed out`));
    }, REQUEST_TIMEOUT_MILLISECONDS);
    pending.set(call.id, { resolve, reject, timeout });
  });

const settlePending = (
  endpoint: string,
  pending: Map<number, PendingRpc>,
  data: string,
): void => {
  try {
    const payload: unknown = JSON.parse(data);
    if (!isJsonRecord(payload) || typeof payload["id"] !== "number") return;
    const id = payload["id"];
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    clearTimeout(waiter.timeout);
    waiter.resolve(unwrapRpc(payload, endpoint, `rpc#${id}`));
  } catch (error) {
    void error;
  }
};

const failPending = (
  endpoint: string,
  pending: Map<number, PendingRpc>,
  reason: string,
): void => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(new Error(`MCP ${endpoint}: ${reason}`));
  }
  pending.clear();
};

const pump = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const result = await reader.read();
    if (result.done) return;
    buffer += decoder.decode(result.value, { stream: true });
    const blocks = buffer.split(EVENT_SEPARATOR);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseSseEvent(block);
      if (event !== undefined) onEvent(event);
    }
  }
};

export const parseSseText = (text: string): readonly SseEvent[] =>
  text.split(EVENT_SEPARATOR).flatMap((block) => {
    const event = parseSseEvent(block);
    return event === undefined ? [] : [event];
  });

const parseSseEvent = (block: string): SseEvent | undefined => {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(EVENT_PREFIX)) {
      event = line.slice(EVENT_PREFIX.length).trim();
    }
    if (line.startsWith(DATA_PREFIX)) {
      data.push(line.slice(DATA_PREFIX.length).trimStart());
    }
  }
  return data.length === 0 ? undefined : { event, data: data.join("\n") };
};
