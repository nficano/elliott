import { unwrapRpc } from "./http.js";
import type { McpFetch, McpServerConfig, McpWire, SseEvent } from "./types.js";

const REQUEST_TIMEOUT_MS = 60_000;
const EVENT_SEPARATOR = /\r?\n\r?\n/;
const EVENT_PREFIX = "event:";
const DATA_PREFIX = "data:";

/**
 * Classic SSE wire (Home Assistant's MCP Server integration speaks this): one
 * long-lived GET stream; the server's first `endpoint` event names the URL to
 * POST rpc bodies to, and every response comes back as a `message` event on
 * the stream, matched to its caller by rpc id. No auto-reconnect in v1 — a
 * dropped stream fails in-flight calls and the next activation reconnects.
 */
export function makeSseWire(
  cfg: McpServerConfig,
  fetchImpl: McpFetch,
): McpWire {
  const waiters = makeWaiters(cfg);
  const abort = new AbortController();
  let endpoint: string | undefined;
  let nextId = 1;

  const onEvent = (event: SseEvent, ready: (url: string) => void): void => {
    if (event.event === "endpoint") {
      ready(new URL(event.data, cfg.url).href);
      return;
    }
    try {
      waiters.settle(JSON.parse(event.data));
    } catch {
      // pings/comments — ignore
    }
  };

  return {
    async start() {
      endpoint = await openStream({ cfg, fetchImpl, abort, onEvent, waiters });
    },

    async request(method, params) {
      if (!endpoint) throw new Error(`mcp ${cfg.id}: SSE wire not started`);
      const id = nextId++;
      const answer = waiters.expect(id, method);
      await postRpc({ cfg, fetchImpl, endpoint }, {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      });
      return answer;
    },

    async notify(method) {
      if (!endpoint) throw new Error(`mcp ${cfg.id}: SSE wire not started`);
      await postRpc({ cfg, fetchImpl, endpoint }, {
        jsonrpc: "2.0",
        method,
      });
    },

    async close() {
      abort.abort();
      waiters.failAll("closed");
    },
  };
}

/** GET the stream; resolves with the POST endpoint once the server names it. */
async function openStream(io: {
  readonly cfg: McpServerConfig;
  readonly fetchImpl: McpFetch;
  readonly abort: AbortController;
  readonly onEvent: (event: SseEvent, ready: (url: string) => void) => void;
  readonly waiters: { failAll: (why: string) => void; };
}): Promise<string> {
  const { cfg, fetchImpl, abort, onEvent, waiters } = io;
  const res = await fetchImpl(cfg.url ?? "", {
    headers: {
      accept: "text/event-stream",
      ...cfg.headers,
    },
    signal: abort.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`mcp ${cfg.id}: SSE connect HTTP ${res.status}`);
  }
  return new Promise<string>((resolve, reject) => {
    pump(res.body!, (event) => onEvent(event, resolve))
      .then(() => {
        waiters.failAll("SSE stream closed");
        reject(new Error(`mcp ${cfg.id}: SSE stream closed`));
      })
      .catch((error: Error) => {
        waiters.failAll(error.message);
        reject(error);
      });
  });
}

/** Pending rpc bookkeeping: id-matched settlement, timeouts, mass failure. */
function makeWaiters(cfg: McpServerConfig): {
  expect: (id: number, method: string) => Promise<unknown>;
  settle: (payload: unknown) => void;
  failAll: (why: string) => void;
} {
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; }
  >();
  return {
    expect: (id, method) =>
      new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error(`mcp ${cfg.id}: ${method} timed out`));
        }, REQUEST_TIMEOUT_MS);
      }),
    settle: (payload) => {
      const rpc = payload as { id?: unknown; } | undefined;
      if (typeof rpc?.id !== "number") return;
      const waiter = pending.get(rpc.id);
      if (!waiter) return;
      pending.delete(rpc.id);
      try {
        waiter.resolve(unwrapRpc(payload, cfg.id, `rpc#${rpc.id}`));
      } catch (error) {
        waiter.reject(error as Error);
      }
    },
    failAll: (why) => {
      for (const waiter of pending.values()) {
        waiter.reject(new Error(`mcp ${cfg.id}: ${why}`));
      }
      pending.clear();
    },
  };
}

async function postRpc(
  target: {
    cfg: McpServerConfig;
    fetchImpl: McpFetch;
    endpoint: string;
  },
  body: Record<string, unknown>,
): Promise<void> {
  const res = await target.fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...target.cfg.headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `mcp ${target.cfg.id}: rpc POST HTTP ${res.status}`,
    );
  }
  await res.body?.cancel();
}

/** Read the stream, emitting each complete SSE event; resolves at EOF. */
async function pump(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(EVENT_SEPARATOR);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (event) onEvent(event);
    }
  }
}

/** Parse one full text/event-stream body into events (unary HTTP responses). */
export function parseSseText(text: string): SseEvent[] {
  return text
    .split(EVENT_SEPARATOR)
    .map(parseSseEvent)
    .filter((event): event is SseEvent => event !== undefined);
}

function parseSseEvent(block: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(EVENT_PREFIX)) {
      event = line.slice(EVENT_PREFIX.length).trim();
    } else if (line.startsWith(DATA_PREFIX)) {
      data.push(line.slice(DATA_PREFIX.length).trimStart());
    }
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}
