import type * as Effect from "effect/Effect";
import type { McpError } from "../errors.js";

export type McpTransport = "streamable-http" | "sse" | "stdio";

export interface McpServerConfig {
  readonly id: string;
  readonly transport: McpTransport;
  readonly url?: string;
  readonly command?: string;
  readonly args?: string[];
  readonly headers?: Record<string, string>;
  /** DNS-rebinding allowlist headers (oslo lesson, §7.5). */
  readonly allowedHosts?: string[];
}

/** A discovered server tool, annotations distilled to what the registry needs. */
export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  /** The server's JSON Schema for arguments, passed to the model verbatim. */
  readonly inputSchema: Record<string, unknown>;
  /** `annotations.readOnlyHint === true` — everything else is treated as a write. */
  readonly readOnly: boolean;
}

/**
 * MCP client (§7.5). Hand-rolled Streamable-HTTP/SSE JSON-RPC (stdio: not yet).
 * `connect` → `initialize` → `notifications/initialized` → `tools/list`;
 * persistent session; `call(name, args)`. Lazy connect + circuit breaker
 * (§8.2): a down MCP has its tools drop out, the turn degrades.
 */
export interface McpClient {
  readonly id: string;
  connect(): Effect.Effect<McpToolInfo[], McpError>;
  call(name: string, args: unknown): Effect.Effect<string, McpError>;
  close(): Promise<void>;
  readonly connected: boolean;
}

/** One SSE event as parsed off a text/event-stream body. */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * Transport seam under the client: a JSON-RPC pipe. `request` resolves with
 * the rpc `result` (throws on rpc `error`); `notify` sends a fire-and-forget
 * notification. Tests inject a fake wire; production wires are http.ts/sse.ts.
 */
export interface McpWire {
  /** Open the pipe (SSE: GET stream + endpoint handshake; HTTP: no-op). */
  start(): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string): Promise<void>;
  close(): Promise<void>;
}

/** Minimal fetch surface the wires need (keeps Bun's extras out of the seam). */
export type McpFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface McpClientDeps {
  readonly fetchImpl?: McpFetch;
  /** Test seam: replaces the transport entirely. */
  readonly wire?: McpWire;
}
