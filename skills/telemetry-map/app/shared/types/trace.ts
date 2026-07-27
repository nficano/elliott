// Recorded turn telemetry as served by GET /v1/observability/map/turn?id=…
export interface TurnEvent {
  readonly seq: number;
  readonly at: string;
  readonly type: string;
  readonly runId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface TurnDetail {
  readonly runId: string;
  readonly events: readonly TurnEvent[];
}

// One debug-trace step: the node the recorded event landed on, what that
// node received, and what it returned — plus the raw event for the toggle.
export interface TraceStep {
  readonly nodeId: string;
  readonly from: string;
  readonly title: string;
  readonly action: string;
  readonly at: string;
  readonly eventType: string;
  readonly received: Readonly<Record<string, unknown>>;
  readonly returned: Readonly<Record<string, unknown>>;
  readonly raw: unknown;
}

// One row in the invocations card.
export interface InvocationItem {
  readonly runId: string;
  text: string;
  gateway: string;
  sender: string;
  startedAt: string;
  disposition: string;
}
