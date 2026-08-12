import { describe, expect, it } from "bun:test";
import { digest, scopeId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { ModelDispatcher } from "../../src/model/resolver";
import { RouteTableStore } from "../../src/model/routetable";
import { makeRouteContext } from "../helpers";

describe("G11 model selection audit", () => {
  it("records every selection field and under-declaration", async () => {
    const records = new MemoryRecordAppender();
    const decision = await new ModelDispatcher(
      new RouteTableStore(),
      records,
    ).select({
      task: {
        profile: "fast",
        declaredClassification: "public",
        operation: "chat",
        requires: ["text"],
        maxCostUsd: 1,
      },
      frameClassification: "confidential",
      profileDigest: digest("profile"),
      promptPrefixDigest: digest("prefix"),
      scope: { level: "session", id: scopeId("session") },
      usage: {
        promptInputTokens: 100,
        maximumOutputTokens: 50,
        actualOutputTokens: 20,
        cachedInputTokens: 10,
        latencyMs: 25,
      },
      build: makeRouteContext(),
    });
    expect(decision.record).toMatchObject({
      requestedProfile: "fast",
      effectiveProfile: "fast",
      declaredClassification: "public",
      frameHighWaterMark: "confidential",
      effectiveClassification: "confidential",
      underDeclared: true,
      provider: "local",
      model: "model",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 20,
      latencyMs: 25,
    });
    expect(decision.record.residencyGrantRef).toBeTruthy();
    expect(decision.record.routeTableVersion).toBeTruthy();
    expect(records.list().some((record) => record.type === "model.selection"))
      .toBe(true);
  });
});
