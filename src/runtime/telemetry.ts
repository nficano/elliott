import { hashValue } from "../core/digest";
import type {
  ModelTurnRequest,
  TelemetryBus,
  TelemetryEnvelope,
  TelemetryEventType,
  TelemetrySubscriber,
  TurnObserver,
} from "./types";

const RING_CAPACITY = 512;

// A dependency-free, in-process event bus. Core emits turn activity here; the
// telemetry-map extension subscribes. Failures in one subscriber never affect
// the emitter or other subscribers, and nothing is ever persisted.
class RuntimeTelemetryBus implements TelemetryBus {
  readonly promptsEnabled: boolean;
  readonly #subscribers = new Set<TelemetrySubscriber>();
  readonly #ring: TelemetryEnvelope[] = [];
  #seq = 0;

  constructor(promptsEnabled: boolean) {
    this.promptsEnabled = promptsEnabled;
  }

  emit(
    type: TelemetryEventType,
    payload: Readonly<Record<string, unknown>>,
    runId?: string,
  ): void {
    this.#seq += 1;
    const event: TelemetryEnvelope = {
      seq: this.#seq,
      at: new Date().toISOString(),
      type,
      payload,
      ...(runId !== undefined && { runId }),
    };
    this.#ring.push(event);
    if (this.#ring.length > RING_CAPACITY) this.#ring.shift();
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(event);
      } catch {
        // Subscriber isolation: a broken map listener must never break a turn.
      }
    }
  }

  subscribe(subscriber: TelemetrySubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  recent(): readonly TelemetryEnvelope[] {
    return [...this.#ring];
  }
}

const promptsEnabled = Bun.env["ELLIOTT_TELEMETRY_PROMPTS"] !== "0";

export const runtimeTelemetry: TelemetryBus = new RuntimeTelemetryBus(
  promptsEnabled,
);

const requestPayload = (
  request: ModelTurnRequest,
  round: number,
): Readonly<Record<string, unknown>> => {
  const toolNames = request.tools.map((tool) => tool.name);
  const base = {
    round,
    messageCount: request.messages.length,
    toolNames,
    systemDigest: hashValue(request.system),
    messagesDigest: hashValue(request.messages),
  };
  return runtimeTelemetry.promptsEnabled
    ? { ...base, system: request.system, messages: request.messages }
    : base;
};

// Wrap the runtime's real turn observer (evolution evidence / gateway) so that
// model selection, tool progress, and the assembled request also fan out to the
// telemetry bus, correlated by runId. Pass-through preserves delegate behavior.
export const telemetryTurnObserver = (
  delegate: TurnObserver | undefined,
  runId: string,
): TurnObserver => {
  let round = 0;
  return {
    ...(delegate?.onTextDelta !== undefined
      && { onTextDelta: delegate.onTextDelta }),
    onModelRequest: async (request) => {
      round += 1;
      runtimeTelemetry.emit(
        "model.request",
        requestPayload(request, round),
        runId,
      );
      await delegate?.onModelRequest?.(request);
    },
    onModelSelection: async (selection) => {
      runtimeTelemetry.emit("model.selection", { ...selection }, runId);
      await delegate?.onModelSelection?.(selection);
    },
    onToolProgress: async (progress) => {
      runtimeTelemetry.emit("tool.progress", { ...progress }, runId);
      await delegate?.onToolProgress?.(progress);
    },
  };
};
