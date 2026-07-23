import type { RawUsage } from "../types.js";

export interface ToolAccumulator {
  id: string;
  name: string;
  args: string[];
}

export interface StreamAccumulator {
  readonly textParts: string[];
  readonly tools: Map<number, ToolAccumulator>;
  ttftMs: number;
  finishReason: string | undefined;
  responseModel: string;
  usageRaw: RawUsage | null | undefined;
}

export interface ToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}
