import type { InvocationItem, TurnEvent } from "#shared/types/trace";

import { pulseHop } from "#shared/engine/state";
import { MAP_BASE } from "#shared/utils/base";
import { gatewayNodeId } from "#shared/utils/trace";

import { useExplorer } from "./useExplorer";

// Subscribes to the live SSE feed: every telemetry event pulses the hop it
// touched on the map (the real-time replacement for the old scripted
// explainer) and keeps the invocations card current.

const AGENT = "runtime.agentLoop";
const LIVE_EVENT_TYPES = [
  "inbound",
  "turn.begin",
  "model.request",
  "model.selection",
  "tool.progress",
  "turn.finish",
  "db.write",
] as const;

const gatewayByRun = new Map<string, string>();

type Hop = [string, string];

const STATIC_HOPS: Partial<Record<TurnEvent["type"], Hop[]>> = {
  "turn.begin": [["runtime.inbound", AGENT]],
  "model.request": [
    [AGENT, "runtime.prompt"],
    ["runtime.prompt", "runtime.modelClient"],
  ],
  "model.selection": [["runtime.modelClient", "runtime.router"]],
  "tool.progress": [[AGENT, "runtime.toolExec"]],
  "db.write": [["database.sessions", "database.sessions"]],
};

const inboundHops = (event: TurnEvent): Hop[] => {
  const gateway = gatewayNodeId(event.payload["gateway"]);
  if (event.runId !== undefined) gatewayByRun.set(event.runId, gateway);
  return [[gateway, "runtime.inbound"]];
};

const finishHops = (event: TurnEvent): Hop[] => {
  const runGateway = event.runId === undefined
    ? "obs.map"
    : gatewayByRun.get(event.runId) ?? "obs.map";
  return [[AGENT, runGateway]];
};

const hopsFor = (event: TurnEvent): Hop[] => {
  if (event.type === "inbound") return inboundHops(event);
  if (event.type === "turn.finish") return finishHops(event);
  return STATIC_HOPS[event.type] ?? [];
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const invocationFromInbound = (event: TurnEvent): InvocationItem => ({
  runId: event.runId ?? "",
  text: asString(event.payload["text"]),
  gateway: asString(event.payload["gateway"]),
  sender: asString(event.payload["sender"]),
  startedAt: event.at,
  disposition: "",
});

const upsertInvocation = (event: TurnEvent): void => {
  const explorer = useExplorer();
  if (event.runId === undefined) return;
  const list = [...explorer.invocations.value];
  const index = list.findIndex((item) => item.runId === event.runId);
  if (event.type === "inbound" && index === -1) {
    explorer.invocations.value = [invocationFromInbound(event), ...list];
    return;
  }
  if (index === -1) return;
  const item = { ...list[index]! };
  if (event.type === "turn.finish") {
    item.disposition = asString(event.payload["disposition"]);
  }
  list[index] = item;
  explorer.invocations.value = list;
};

const onLiveEvent = (event: TurnEvent): void => {
  const explorer = useExplorer();
  const state = explorer.engineState.value;
  if (state) {
    for (const [from, to] of hopsFor(event)) pulseHop(state, from, to);
  }
  if (event.type === "inbound" || event.type === "turn.finish") {
    upsertInvocation(event);
  }
};

// Seed the invocations card from the turns the server already remembers.
export const seedInvocations = async (): Promise<void> => {
  const explorer = useExplorer();
  try {
    const response = await fetch(`${MAP_BASE}/state`);
    if (!response.ok) return;
    const snapshot = (await response.json()) as {
      turns?: {
        runId: string;
        text?: string;
        gateway?: string;
        sender?: string;
        startedAt?: string;
        disposition?: string;
      }[];
    };
    explorer.invocations.value = (snapshot.turns ?? [])
      .map((turn): InvocationItem => ({
        runId: turn.runId,
        text: turn.text ?? "",
        gateway: turn.gateway ?? "",
        sender: turn.sender ?? "",
        startedAt: turn.startedAt ?? "",
        disposition: turn.disposition ?? "",
      }))
      .toReversed();
  } catch {
    // The card stays empty until live events arrive.
  }
};

let source: EventSource | undefined;

export const startLiveTelemetry = (): void => {
  if (source) return;
  source = new EventSource(`${MAP_BASE}/stream`);
  for (const type of LIVE_EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      try {
        onLiveEvent(JSON.parse((message as MessageEvent).data) as TurnEvent);
      } catch {
        // Malformed frames are dropped; the stream keeps flowing.
      }
    });
  }
};

export const stopLiveTelemetry = (): void => {
  source?.close();
  source = undefined;
};
