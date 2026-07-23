import { describe, expect, it } from "bun:test";
import { digest, scopeId } from "../../src/core/brands";
import { NoEligibleRouteError } from "../../src/core/errors";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { ModelDispatcher } from "../../src/model/resolver";
import { RouteTableStore } from "../../src/model/routetable";
import {
  makeCatalogEntry,
  makeProviderState,
  makeRouteContext,
} from "../helpers";

describe("G9/G10 fail-closed routing", () => {
  it("never invokes a capability-deficient route", () => {
    const context = makeRouteContext(
      makeProviderState("local", [
        makeCatalogEntry("model", "local", ["text"]),
      ]),
    );
    expect(() =>
      new RouteTableStore().resolve({
        profile: "fast",
        effectiveClassification: "internal",
        requiredCapabilities: ["vision"],
      }, context)
    ).toThrow(NoEligibleRouteError);
  });

  it("raises instead of relaxing the budget filter", async () => {
    const context = makeRouteContext();
    const dispatcher = new ModelDispatcher(
      new RouteTableStore(),
      new MemoryRecordAppender(),
    );
    await expect(dispatcher.select({
      task: {
        profile: "fast",
        declaredClassification: "internal",
        operation: "chat",
        requires: ["text"],
        maxCostUsd: 0,
      },
      frameClassification: "internal",
      profileDigest: digest("profile"),
      promptPrefixDigest: digest("prefix"),
      scope: { level: "session", id: scopeId("session") },
      usage: {
        promptInputTokens: 100,
        maximumOutputTokens: 100,
        actualOutputTokens: 0,
        cachedInputTokens: 0,
        latencyMs: 0,
      },
      build: context,
    })).rejects.toMatchObject({ emptiedBy: "budget" });
  });
});
