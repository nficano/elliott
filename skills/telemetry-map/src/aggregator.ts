import type {
  TelemetryBus,
  TelemetryEnvelope,
} from "../../../src/runtime/types";
import type {
  ClientListener,
  DbSnapshot,
  MapMeta,
  MapSnapshot,
  RunSummary,
  TelemetryPayload,
  TurnDetail,
} from "./types";

const MAX_EVENTS = 400;
const MAX_TURNS = 60;
const EMPTY_DB: DbSnapshot = { at: "", tables: [], recent: {} };

const text = (payload: TelemetryPayload, key: string): string | undefined => {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

const summaryHandlers: Record<
  string,
  (summary: RunSummary, payload: TelemetryPayload) => void
> = {
  inbound: (summary, payload) => {
    const gateway = text(payload, "gateway");
    if (gateway !== undefined) summary.gateway = gateway;
    const sender = text(payload, "sender");
    if (sender !== undefined) summary.sender = sender;
    const channel = text(payload, "channel");
    if (channel !== undefined) summary.channel = channel;
  },
  "turn.begin": (summary, payload) => {
    const conversation = text(payload, "conversation");
    if (conversation !== undefined) summary.conversation = conversation;
  },
  "model.request": (summary) => {
    summary.rounds += 1;
  },
  "model.selection": (summary, payload) => {
    const routeDigest = text(payload, "routeDigest");
    if (routeDigest !== undefined) summary.routeDigest = routeDigest;
  },
  "tool.progress": (summary, payload) => {
    const status = text(payload, "status");
    if (status === "complete") summary.tools += 1;
    else if (status === "error") summary.toolErrors += 1;
  },
  "turn.finish": (summary, payload) => {
    const disposition = text(payload, "disposition");
    if (disposition !== undefined) summary.disposition = disposition;
  },
};

const applyToSummary = (
  summary: RunSummary,
  event: TelemetryEnvelope,
): void => {
  summary.startedAt ??= event.at;
  if (event.type === "turn.finish") summary.finishedAt = event.at;
  const handler = summaryHandlers[event.type];
  if (handler !== undefined) handler(summary, event.payload);
};

const summarize = (
  runId: string,
  events: readonly TelemetryEnvelope[],
): RunSummary => {
  const summary: RunSummary = { runId, rounds: 0, tools: 0, toolErrors: 0 };
  for (const event of events) applyToSummary(summary, event);
  return summary;
};

// The map's in-memory hub: subscribes to the telemetry bus, keeps a bounded
// window of events grouped by turn, holds the latest DB snapshot, and fans live
// events out to any connected SSE clients.
export class Aggregator {
  readonly #meta: MapMeta;
  readonly #events: TelemetryEnvelope[] = [];
  readonly #runs = new Map<string, TelemetryEnvelope[]>();
  readonly #order: string[] = [];
  readonly #clients = new Set<ClientListener>();
  #db: DbSnapshot = EMPTY_DB;
  #unsubscribe: (() => void) | undefined;

  constructor(meta: MapMeta) {
    this.#meta = meta;
  }

  start(bus: TelemetryBus): void {
    for (const event of bus.recent()) this.#ingest(event);
    this.#unsubscribe = bus.subscribe((event) => this.#ingest(event));
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#clients.clear();
  }

  setDb(snapshot: DbSnapshot): void {
    this.#db = snapshot;
  }

  addClient(client: ClientListener): () => void {
    this.#clients.add(client);
    return () => {
      this.#clients.delete(client);
    };
  }

  snapshot(): MapSnapshot {
    const turns = this.#order.map((id) =>
      summarize(id, this.#runs.get(id) ?? [])
    );
    return {
      generatedAt: new Date().toISOString(),
      meta: this.#meta,
      db: this.#db,
      turns,
      events: [...this.#events],
    };
  }

  turn(runId: string): TurnDetail {
    return { runId, events: [...(this.#runs.get(runId) ?? [])] };
  }

  health(): Readonly<Record<string, number>> {
    return {
      turns: this.#runs.size,
      events: this.#events.length,
      clients: this.#clients.size,
      dbTables: this.#db.tables.length,
    };
  }

  #ingest(event: TelemetryEnvelope): void {
    this.#events.push(event);
    if (this.#events.length > MAX_EVENTS) this.#events.shift();
    this.#track(event);
    for (const client of this.#clients) {
      try {
        client(event);
      } catch {
        // Client isolation: a dead SSE stream must not stall ingestion.
      }
    }
  }

  #track(event: TelemetryEnvelope): void {
    const runId = event.runId;
    if (runId === undefined) return;
    let bucket = this.#runs.get(runId);
    if (bucket === undefined) {
      bucket = [];
      this.#runs.set(runId, bucket);
      this.#order.push(runId);
      while (this.#order.length > MAX_TURNS) {
        const oldest = this.#order.shift();
        if (oldest !== undefined) this.#runs.delete(oldest);
      }
    }
    bucket.push(event);
  }
}
