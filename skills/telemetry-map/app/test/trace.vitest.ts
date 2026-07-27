import type { TurnEvent } from "#shared/types/trace";

import {
  buildTraceSteps,
  gatewayNodeId,
  traceFlow,
} from "#shared/utils/trace";
import { describe, expect, it } from "vitest";

const event = (
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): TurnEvent => ({
  seq,
  at: `2026-07-27T00:00:0${seq}.000Z`,
  type,
  runId: "run-1",
  payload,
});

const FULL_TURN: TurnEvent[] = [
  event(1, "inbound", {
    messageId: "m-1",
    gateway: "telemetry-map",
    channel: "telemetry-map:interactive",
    sender: "map-observer",
    textLength: 5,
    text: "hello",
  }),
  event(2, "turn.begin", { conversation: "telemetry-map:x:root" }),
  event(3, "model.request", {
    round: 1,
    messageCount: 3,
    toolNames: ["fetch", "files"],
    systemDigest: "sys-1",
    messagesDigest: "msg-1",
    system: "You are Elliott.",
    messages: [{ role: "user", content: "hello" }],
  }),
  event(4, "model.selection", { routeDigest: "route-1" }),
  event(5, "tool.progress", {
    id: "t-1",
    name: "fetch",
    status: "complete",
    resultDigest: "res-1",
  }),
  event(6, "turn.finish", {
    disposition: "success",
    answerLength: 6,
    answer: "hi you",
  }),
];

describe("gatewayNodeId", () => {
  it("maps gateway names onto topology nodes", () => {
    expect(gatewayNodeId("gateway-slack")).toBe("gateway.slack");
    expect(gatewayNodeId("slack")).toBe("gateway.slack");
    expect(gatewayNodeId("gateway-webhook")).toBe("gateway.webhook");
    expect(gatewayNodeId("telemetry-map")).toBe("obs.map");
    expect(gatewayNodeId()).toBe("obs.map");
  });
});

describe("buildTraceSteps", () => {
  const steps = buildTraceSteps(FULL_TURN);

  it("walks the runtime path in recorded order", () => {
    expect(steps.map((step) => step.nodeId)).toEqual([
      "obs.map",
      "runtime.inbound",
      "runtime.agentLoop",
      "runtime.prompt",
      "runtime.modelClient",
      "runtime.router",
      "runtime.toolExec",
      "runtime.agentLoop",
      "obs.map",
    ]);
  });

  it("chains each step from the previous node", () => {
    expect(steps[0]?.from).toBe(steps[0]?.nodeId);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]?.from).toBe(steps[i - 1]?.nodeId);
    }
  });

  it("shows the message text as received at the gateway", () => {
    expect(steps[0]?.received).toMatchObject({
      text: "hello",
      sender: "map-observer",
    });
    expect(steps[0]?.returned).toMatchObject({ messageId: "m-1" });
  });

  it("surfaces the assembled prompt at the prompt node", () => {
    const prompt = steps.find((step) => step.nodeId === "runtime.prompt");
    expect(prompt?.received).toMatchObject({
      round: 1,
      system: "You are Elliott.",
    });
    expect(prompt?.returned).toMatchObject({
      toolNames: ["fetch", "files"],
      systemDigest: "sys-1",
    });
  });

  it("records tool status and the final answer", () => {
    const tool = steps.find((step) => step.nodeId === "runtime.toolExec");
    expect(tool?.title).toBe("Tool · fetch");
    expect(tool?.returned).toMatchObject({ status: "complete" });
    const delivery = steps.at(-1);
    expect(delivery?.returned).toMatchObject({ answer: "hi you" });
  });

  it("keeps the raw event on every step for the raw toggle", () => {
    for (const step of steps) {
      expect((step.raw as TurnEvent).type).toBe(step.eventType);
    }
  });

  it("returns nothing for an empty or unknown event list", () => {
    expect(buildTraceSteps([])).toEqual([]);
    expect(buildTraceSteps([event(1, "heartbeat", {})])).toEqual([]);
  });
});

describe("traceFlow", () => {
  it("adapts trace steps onto the flow machinery", () => {
    const steps = buildTraceSteps(FULL_TURN);
    const flow = traceFlow("run-1", "Replay · hello", steps);
    expect(flow.id).toBe("trace:run-1");
    expect(flow.steps.length).toBe(steps.length);
    expect(flow.steps[3]).toMatchObject({
      from: "runtime.agentLoop",
      to: "runtime.prompt",
      transport: "recorded",
    });
  });
});
