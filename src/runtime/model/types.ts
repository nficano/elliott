import type {
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
} from "../types";

// One HTTP call, fully described by the wire that built it. The client owns
// transport (fetch, watchdog, attestation); a wire owns protocol.
export interface ModelWireRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface ModelWire {
  // Human-readable protocol name, used in transport error messages so a
  // stalled call names the endpoint it was actually speaking to.
  readonly name: string;
  readonly request: (
    settings: RuntimeSettings,
    request: ModelTurnRequest,
    streaming: boolean,
  ) => ModelWireRequest;
  readonly decode: (payload: unknown) => ModelTurnResult;
  readonly decodeStream: (
    response: Response,
    onTextDelta: (delta: string) => Promise<void>,
    onActivity?: () => void,
  ) => Promise<ModelTurnResult>;
}

// Accumulator threaded through Anthropic's content-block stream events.
export interface AnthropicStreamState {
  text: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  readonly calls: Map<number, { id: string; name: string; arguments: string; }>;
}
