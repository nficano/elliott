import type {
  McpEndpointSettings,
  ToolDefinition,
} from "../../../src/runtime/types";

export interface RpcWire {
  start(): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string): Promise<void>;
  close(): Promise<void>;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpConnection {
  readonly settings: McpEndpointSettings;
  readonly tools: readonly McpToolInfo[];
  definitions(): readonly ToolDefinition[];
  close(): Promise<void>;
}

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export interface PendingRpc {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface PendingCall {
  readonly endpoint: string;
  readonly id: number;
  readonly method: string;
}
