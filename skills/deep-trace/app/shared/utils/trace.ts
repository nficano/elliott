import type { Flow, FlowStep } from "../types/explorer";
import type { TraceStep, TurnEvent } from "../types/trace";

// Maps a recorded turn (telemetry events) onto the topology nodes so a
// replay can walk the runtime path like a debugger: no re-execution, just
// the recorded data at each hop.

const AGENT = "runtime.agentLoop";
const INBOUND = "runtime.inbound";

export const gatewayNodeId = (gateway: unknown): string => {
  const name = String(gateway ?? "").toLowerCase();
  if (name.includes("slack")) return "gateway.slack";
  if (name.includes("webhook")) return "gateway.webhook";
  return "obs.map";
};

const pick = (
  payload: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
};

type StepInput = Omit<TraceStep, "from">;

const inboundSteps = (event: TurnEvent): StepInput[] => {
  const gateway = gatewayNodeId(event.payload["gateway"]);
  return [
    {
      nodeId: gateway,
      title: "Inbound message",
      action: "The gateway received the message and handed it to the runtime.",
      at: event.at,
      eventType: event.type,
      received: pick(event.payload, ["text", "sender", "channel"]),
      returned: pick(event.payload, ["messageId", "gateway", "textLength"]),
      raw: event,
    },
    {
      nodeId: INBOUND,
      title: "Inbound dispatch",
      action: "The runtime normalized the message and opened a turn for it.",
      at: event.at,
      eventType: event.type,
      received: pick(event.payload, ["messageId", "gateway", "channel"]),
      returned: { runId: event.runId },
      raw: event,
    },
  ];
};

const beginStep = (event: TurnEvent): StepInput => ({
  nodeId: AGENT,
  title: "Turn opened",
  action: "The agent loop opened the turn and entered the bounded round loop.",
  at: event.at,
  eventType: event.type,
  received: pick(event.payload, ["conversation"]),
  returned: pick(event.payload, ["snapshotId"]),
  raw: event,
});

const requestSteps = (event: TurnEvent): StepInput[] => {
  const round = event.payload["round"];
  return [
    {
      nodeId: "runtime.prompt",
      title: `Prompt assembly · round ${String(round ?? "?")}`,
      action:
        "The prompt assembler built the system context, conversation, and tool schemas for this round.",
      at: event.at,
      eventType: event.type,
      received: pick(event.payload, ["round", "messages", "system"]),
      returned: pick(event.payload, [
        "messageCount",
        "toolNames",
        "systemDigest",
        "messagesDigest",
      ]),
      raw: event,
    },
    {
      nodeId: "runtime.modelClient",
      title: "Model request",
      action: "The model client submitted the prepared completion request.",
      at: event.at,
      eventType: event.type,
      received: pick(event.payload, [
        "round",
        "messageCount",
        "toolNames",
      ]),
      returned: pick(event.payload, ["systemDigest", "messagesDigest"]),
      raw: event,
    },
  ];
};

const selectionStep = (event: TurnEvent): StepInput => ({
  nodeId: "runtime.router",
  title: "Route attestation",
  action: "The router attested the model route before completion.",
  at: event.at,
  eventType: event.type,
  received: pick(event.payload, ["requestedModel", "provider", "model"]),
  returned: event.payload,
  raw: event,
});

const toolStep = (event: TurnEvent): StepInput => {
  const name = String(event.payload["name"] ?? "tool");
  const status = String(event.payload["status"] ?? "");
  return {
    nodeId: "runtime.toolExec",
    title: `Tool · ${name}`,
    action: `The tool runner reported ${name} as ${status || "in progress"}.`,
    at: event.at,
    eventType: event.type,
    received: pick(event.payload, [
      "name",
      "requestedTool",
      "selectedTool",
      "argumentsDigest",
      "schemaDigest",
    ]),
    returned: pick(event.payload, ["status", "resultDigest", "errorTag"]),
    raw: event,
  };
};

const finishSteps = (
  event: TurnEvent,
  gateway: string,
): StepInput[] => [
  {
    nodeId: AGENT,
    title: "Turn finished",
    action: "The agent loop resolved the turn.",
    at: event.at,
    eventType: event.type,
    received: {},
    returned: pick(event.payload, ["disposition", "answerLength"]),
    raw: event,
  },
  {
    nodeId: gateway,
    title: "Answer delivered",
    action: "The runtime delivered the answer back through the gateway.",
    at: event.at,
    eventType: event.type,
    received: pick(event.payload, ["disposition"]),
    returned: pick(event.payload, ["answer", "answerLength"]),
    raw: event,
  },
];

const stepsForEvent = (
  event: TurnEvent,
  gateway: string,
): StepInput[] => {
  switch (event.type) {
    case "inbound": {
      return inboundSteps(event);
    }
    case "turn.begin": {
      return [beginStep(event)];
    }
    case "model.request": {
      return requestSteps(event);
    }
    case "model.selection": {
      return [selectionStep(event)];
    }
    case "tool.progress": {
      return [toolStep(event)];
    }
    case "turn.finish": {
      return finishSteps(event, gateway);
    }
    default: {
      return [];
    }
  }
};

export const buildTraceSteps = (
  events: readonly TurnEvent[],
): TraceStep[] => {
  const inbound = events.find((event) => event.type === "inbound");
  const gateway = gatewayNodeId(inbound?.payload["gateway"]);
  const steps: TraceStep[] = [];
  for (const event of events) {
    for (const input of stepsForEvent(event, gateway)) {
      const previous = steps.at(-1)?.nodeId ?? input.nodeId;
      steps.push({ ...input, from: previous });
    }
  }
  return steps;
};

// Adapt trace steps onto the existing flow machinery so the comet and the
// transport controls (step/play/exit) drive the replay.
export const traceFlow = (
  runId: string,
  name: string,
  steps: readonly TraceStep[],
): Flow => ({
  id: `trace:${runId}`,
  name,
  steps: steps.map((step): FlowStep => ({
    from: step.from,
    to: step.nodeId,
    action: step.action,
    data: [step.eventType],
    transport: "recorded",
    result: "",
  })),
  consistencyNotes: [],
  failurePoints: [],
});
