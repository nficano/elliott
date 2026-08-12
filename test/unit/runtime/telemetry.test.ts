import { describe, expect, it } from "bun:test";
import {
  runtimeTelemetry,
  telemetryTurnObserver,
} from "../../../src/runtime/telemetry";

describe("runtime telemetry bus", () => {
  it("emits to subscribers, isolates failures, and retains a ring", () => {
    const seen: string[] = [];
    const unsubscribe = runtimeTelemetry.subscribe((event) => {
      seen.push(event.type);
      if (event.type === "model.selection") throw new Error("boom");
    });
    runtimeTelemetry.emit("model.request", { round: 1 }, "run-1");
    runtimeTelemetry.emit("model.selection", { model: "m" }, "run-1");
    runtimeTelemetry.emit("tool.progress", { tool: "t" }, "run-1");
    expect(seen).toEqual([
      "model.request",
      "model.selection",
      "tool.progress",
    ]);
    expect(runtimeTelemetry.recent().some((e) => e.runId === "run-1")).toBe(
      true,
    );
    unsubscribe();
  });

  it("wraps a turn observer and forwards model/tool events", async () => {
    const calls: string[] = [];
    const observer = telemetryTurnObserver({
      onModelRequest: async () => {
        calls.push("request");
      },
      onModelSelection: async () => {
        calls.push("selection");
      },
      onToolProgress: async () => {
        calls.push("tool");
      },
      onTextDelta: (text) => {
        calls.push(`delta:${text}`);
      },
    }, "run-2");
    await observer.onModelRequest?.({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{
        name: "t",
        description: "d",
        inputSchema: {},
        execute: async () => "",
      }],
    } as never);
    await observer.onModelSelection?.({ model: "m" } as never);
    await observer.onToolProgress?.({ tool: "t" } as never);
    void observer.onTextDelta?.("x");
    expect(calls).toEqual(["request", "selection", "tool", "delta:x"]);
  });
});
