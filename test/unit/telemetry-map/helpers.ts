import type {
  TelemetryBus,
  TelemetryEnvelope,
  TelemetryEventType,
  TelemetrySubscriber,
} from "../../../src/runtime/types";

const counter = { seq: 0 };

export const resetSeq = (): void => {
  counter.seq = 0;
};

export const envelope = (
  type: TelemetryEventType,
  payload: Readonly<Record<string, unknown>> = {},
  runId?: string,
): TelemetryEnvelope => {
  counter.seq += 1;
  return {
    seq: counter.seq,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, counter.seq)).toISOString(),
    type,
    payload,
    ...(runId !== undefined && { runId }),
  };
};

// A deterministic in-memory bus mirroring RuntimeTelemetryBus semantics.
export class FakeTelemetryBus implements TelemetryBus {
  readonly promptsEnabled: boolean;
  readonly subscribers = new Set<TelemetrySubscriber>();
  readonly ring: TelemetryEnvelope[] = [];

  constructor(promptsEnabled = true) {
    this.promptsEnabled = promptsEnabled;
  }

  emit(
    type: TelemetryEventType,
    payload: Readonly<Record<string, unknown>>,
    runId?: string,
  ): void {
    const event = envelope(type, payload, runId);
    this.ring.push(event);
    for (const subscriber of this.subscribers) subscriber(event);
  }

  push(event: TelemetryEnvelope): void {
    this.ring.push(event);
    for (const subscriber of this.subscribers) subscriber(event);
  }

  subscribe(subscriber: TelemetrySubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  recent(): readonly TelemetryEnvelope[] {
    return [...this.ring];
  }
}

export const mapMeta = {
  environment: "test",
  release: "0.0.0-test",
  configuredModel: "test-model",
  promptsEnabled: true,
};
