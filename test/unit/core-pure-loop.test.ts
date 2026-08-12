import { describe, expect, it } from "bun:test";
import { componentRef, snapshotId } from "../../src/core/brands";
import { NoEligibleRouteError } from "../../src/core/errors";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { AgentTurnLoop, dispositionFromInference } from "../../src/loop/index";
import type { LoopInferenceResult } from "../../src/loop/types";

const inference = (
  text: string,
  toolCalls: LoopInferenceResult["toolCalls"] = [],
): LoopInferenceResult => ({ text, toolCalls });

const inbound = {
  id: "inbound",
  actorTrust: "authenticated" as const,
  contentTrust: "untrusted" as const,
  classification: "internal" as const,
  securityTags: [],
  payload: "hi",
  createdAt: "t0",
};

describe("dispositionFromInference", () => {
  it("falls silent on empty inference text", () => {
    const disposition = dispositionFromInference(inference(""), "internal", {
      id: "envelope_1",
      createdAt: "t1",
    });
    expect(disposition).toEqual({
      type: "silent",
      reason: "no-user-visible-result",
    });
  });

  it("builds a frozen respond envelope from the injected id/createdAt", () => {
    const disposition = dispositionFromInference(
      inference("done"),
      "confidential",
      { id: "envelope_1", createdAt: "t1" },
    );
    expect(disposition.type).toBe("respond");
    if (disposition.type !== "respond") throw new Error("expected respond");
    expect(disposition.message).toEqual({
      id: "envelope_1",
      actorTrust: "authenticated",
      contentTrust: "trusted",
      classification: "confidential",
      securityTags: [],
      payload: "done",
      createdAt: "t1",
    });
    expect(Object.isFrozen(disposition.message)).toBe(true);
  });

  it("is deterministic given identical inputs", () => {
    const ctx = { id: "envelope_1", createdAt: "t1" };
    expect(dispositionFromInference(inference("hi"), "internal", ctx)).toEqual(
      dispositionFromInference(inference("hi"), "internal", ctx),
    );
  });
});

describe("AgentTurnLoop.run dispositions", () => {
  it("maps NoEligibleRouteError to a blocked-no-route disposition", async () => {
    const snapshot = snapshotId("snap");
    const error = new NoEligibleRouteError("residency", []);
    const loop = new AgentTurnLoop({
      hasSnapshot: (candidate) => candidate === snapshot,
      dispatcher: {
        async infer() {
          throw error;
        },
      },
      broker: {
        async execute() {
          throw new Error("unused");
        },
      },
      records: new MemoryRecordAppender(),
    });
    const result = await loop.run({ inbound, snapshot, segments: [] });
    expect(result).toEqual({ type: "blocked-no-route", error });
  });

  it("returns silent when the dispatcher yields empty text", async () => {
    const snapshot = snapshotId("snap");
    const loop = new AgentTurnLoop({
      hasSnapshot: () => true,
      dispatcher: {
        async infer() {
          return inference("");
        },
      },
      broker: {
        async execute() {
          throw new Error("unused");
        },
      },
      records: new MemoryRecordAppender(),
    });
    const result = await loop.run({ inbound, snapshot, segments: [] });
    expect(result.type).toBe("silent");
  });

  it("responds and brokers every tool call when text is present", async () => {
    const snapshot = snapshotId("snap");
    let brokered = 0;
    const loop = new AgentTurnLoop({
      hasSnapshot: () => true,
      dispatcher: {
        async infer() {
          return inference("answer", [{
            id: "c1",
            target: componentRef("workspace/tool/echo"),
            operation: "execute",
            input: {},
          }]);
        },
      },
      broker: {
        async execute() {
          brokered += 1;
          return {
            id: "r",
            actorTrust: "authenticated",
            contentTrust: "trusted",
            classification: "internal",
            securityTags: [],
            payload: {},
            createdAt: "t",
          };
        },
      },
      records: new MemoryRecordAppender(),
    });
    const result = await loop.run({ inbound, snapshot, segments: [] });
    expect(result.type).toBe("respond");
    expect(brokered).toBe(1);
  });
});
