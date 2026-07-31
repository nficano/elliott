import type { ExplorerEdge, Flow, FlowStep } from "../types/explorer";

import { presentStrings } from "./pack-nodes";

// Named traces through the verified topology; each references edge ids from
// topology/elliott-topology.enriched.json (legacy parity, byte-for-byte copy).
const FLOW_DEFINITIONS: readonly (readonly [
  string,
  string,
  readonly string[],
])[] = [
  ["flow:owner-model", "Owner message → model", [
    "e.gw-slack.rt",
    "e.inbound.loop",
    "e.loop.prompt",
    "e.prompt.model",
    "e.model.litellm",
    "e.model.router",
    "e.router.selection",
  ]],
  ["flow:webhook-turn", "Verified webhook → turn", [
    "e.http.webhook",
    "e.webhook.inbound",
    "e.inbound.loop",
    "e.loop.prompt",
    "e.prompt.model",
  ]],
  ["flow:tool-search", "Model tool call → search", [
    "e.loop.toolexec",
    "e.tool.search",
  ]],
  ["flow:browser", "Browser tool → companion", [
    "e.loop.toolexec",
    "e.tool.browser",
    "e.browser.companion",
  ]],
  ["flow:evidence", "Turn evidence → SQLite", [
    "e.loop.evidence",
    "e.evidence.store",
    "e.store.db",
  ]],
  ["flow:evolution", "Evidence → evolution proposal", [
    "e.db.signals",
    "e.signals.triage",
    "e.triage.eval",
    "e.eval.companions",
    "e.eval.proposals",
    "e.proposals.control",
  ]],
  ["flow:telemetry", "Runtime events → observability map", [
    "e.tel.inbound",
    "e.tel.model",
    "e.tel.tool",
    "e.tel.map",
    "e.map.telemetry",
    "e.db.map",
  ]],
  ["flow:reminder", "Reminder tool → Slack delivery", [
    "e.loop.toolexec",
    "e.tool.scheduler",
    "e.sched.deliver",
  ]],
];

export const MAP_MESSAGE_FLOW_ID = "flow:map-message";

const MAP_MESSAGE_FLOW: Flow = {
  id: MAP_MESSAGE_FLOW_ID,
  name: "Map message → Elliott",
  steps: [
    {
      from: "obs.map",
      to: "runtime.inbound",
      action:
        "POST /send injects the message through GatewayEvents.onMessage",
      data: ["request", "verified code path"],
      transport: "in-process",
      result: "Telemetry-map gateway captures the reply channel.",
    },
    {
      from: "runtime.inbound",
      to: "runtime.agentLoop",
      action: "Open the turn and call RuntimeAgent.turn",
      data: ["control", "live"],
      transport: "in-process",
      result: "The turn enters the bounded round loop.",
    },
    {
      from: "runtime.agentLoop",
      to: "runtime.prompt",
      action: "Assemble system context, conversation, and tools",
      data: ["prompt", "context"],
      transport: "in-process",
      result: "A ModelTurnRequest is prepared.",
    },
    {
      from: "runtime.prompt",
      to: "runtime.modelClient",
      action: "Submit the prepared model request",
      data: ["model request"],
      transport: "in-process",
      result: "The model client attests its route before completion.",
    },
    {
      from: "runtime.modelClient",
      to: "runtime.router",
      action: "Attest the fixed model route",
      data: ["route digest"],
      transport: "in-process",
      result: "A verified selection returns to the turn.",
    },
    {
      from: "runtime.router",
      to: "runtime.agentLoop",
      action: "Return the attested model selection",
      data: ["selection"],
      transport: "in-process",
      result: "The turn proceeds with the selected route.",
    },
    {
      from: "runtime.agentLoop",
      to: "runtime.modelClient",
      action: "Request model completion",
      data: ["messages", "tools"],
      transport: "in-process",
      result: "The model client sends the completion request.",
    },
    {
      from: "runtime.modelClient",
      to: "provider.litellm",
      action: "POST /v1/chat/completions",
      data: ["completion"],
      transport: "HTTPS",
      result: "LiteLLM returns the model response.",
    },
    {
      from: "provider.litellm",
      to: "runtime.agentLoop",
      action: "Return completion content and any tool calls",
      data: ["response"],
      transport: "HTTPS",
      result: "The turn resolves or begins another tool round.",
    },
    {
      from: "runtime.agentLoop",
      to: "obs.map",
      action: "Capture the gateway response for the waiting /send request",
      data: ["answer"],
      transport: "in-process",
      result: "The answer appears in the Ask Elliott panel.",
    },
  ],
  consistencyNotes: [
    "The request and response seam follows telemetry-map index.ts and gateway.ts.",
  ],
  failurePoints: [
    "The request times out after 180 seconds and leaves the trace visible for inspection.",
  ],
};

const toStep = (edge: ExplorerEdge): FlowStep => ({
  from: edge.from,
  to: edge.to,
  action: edge.purpose || edge.protocol,
  data: presentStrings([
    edge.kind,
    edge.original.contract?.direction,
    edge.original.contract?.delivery,
  ]),
  transport: String(edge.protocol ?? "").split(/\s+\(/, 1)[0] ?? "",
  result: edge.original.activation ?? edge.original.contract?.delivery ?? "",
});

export const buildFlows = (edges: readonly ExplorerEdge[]): Flow[] => {
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const flows = FLOW_DEFINITIONS.map(([id, name, edgeIds]) => {
    const resolved = edgeIds
      .map((edgeId) => edgesById.get(edgeId))
      .filter((edge): edge is ExplorerEdge => edge !== undefined);
    return {
      id,
      name,
      steps: resolved.map(toStep),
      consistencyNotes: resolved.length > 0
        ? ["Every step is sourced from the verified enriched topology."]
        : [],
      failurePoints: presentStrings(
        edgeIds.map((edgeId) => edgesById.get(edgeId)?.failureHandling),
      ),
    };
  }).filter((flow) => flow.steps.length > 0);
  return [MAP_MESSAGE_FLOW, ...flows];
};
