import { describe, expect, it } from "bun:test";
import { componentRef, digest, snapshotId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { AgentTurnLoop, compactCausalBlocks } from "../../src/loop/index";
import type { CausalBlock } from "../../src/loop/types";
import {
  assemblePrompt,
  assertZeroAuthorityInteractionProfile,
  interactionProfileSegment,
} from "../../src/prompt/index";
import type { PromptPurpose, PromptSegment } from "../../src/prompt/types";
import { makeManifest } from "../helpers";

const segment = (
  purpose: PromptPurpose,
  classification: PromptSegment["classification"] = "internal",
): PromptSegment => ({
  purpose,
  source: purpose,
  digest: digest(`segment:${purpose}`),
  trust: purpose === "evidence" ? "untrusted" : "system",
  securityTags: [],
  classification,
  content: purpose,
});

describe("M1 prompt and loop", () => {
  it("orders policy before profile and evidence while raising the frame mark", () => {
    const snapshot = snapshotId("snapshot");
    const profile = interactionProfileSegment({
      source: "profile",
      digest: digest("profile"),
      content: "friendly",
    });
    const prompt = assemblePrompt(snapshot, [
      segment("evidence", "restricted"),
      profile,
      segment("constitution"),
      segment("task"),
    ]);
    expect(prompt.segments.map((item) => item.purpose)).toEqual([
      "constitution",
      "interaction-profile",
      "task",
      "evidence",
    ]);
    expect(prompt.effectiveClassification).toBe("restricted");
    expect(prompt.stablePrefix.map((item) => item.purpose)).toEqual([
      "constitution",
      "interaction-profile",
      "task",
    ]);
  });

  it("rejects executable authority on an interaction profile", () => {
    expect(() =>
      assertZeroAuthorityInteractionProfile(
        makeManifest(
          "interaction-profile",
          "workspace/interaction-profile/unsafe",
          [{ capability: "network.fetch", resources: ["https://example.com"] }],
        ),
      )
    ).toThrow();
  });

  it("runs a turn against the requested snapshot and brokers every tool call", async () => {
    const snapshot = snapshotId("snapshot:fixed");
    let brokerCalls = 0;
    const loop = new AgentTurnLoop({
      hasSnapshot: (candidate) => candidate === snapshot,
      dispatcher: {
        async infer(prompt) {
          expect(prompt.snapshot).toBe(snapshot);
          return {
            text: "done",
            toolCalls: [{
              id: "call-1",
              target: componentRef("workspace/tool/echo"),
              operation: "execute",
              input: { value: "hello" },
            }],
          };
        },
      },
      broker: {
        async execute() {
          brokerCalls += 1;
          return {
            id: "result",
            actorTrust: "authenticated",
            contentTrust: "trusted",
            classification: "internal",
            securityTags: [],
            payload: {},
            createdAt: new Date().toISOString(),
          };
        },
      },
      records: new MemoryRecordAppender(),
    });
    const result = await loop.run({
      inbound: {
        id: "inbound",
        actorTrust: "authenticated",
        contentTrust: "untrusted",
        classification: "internal",
        securityTags: [],
        payload: "hello",
        createdAt: new Date().toISOString(),
      },
      snapshot,
      segments: [segment("constitution"), segment("task")],
    });
    expect(result.type).toBe("respond");
    expect(brokerCalls).toBe(1);
  });

  it("compacts causal blocks atomically and preserves the highest stamp", async () => {
    const blocks: readonly CausalBlock[] = [
      {
        id: "tool-block",
        classification: "confidential",
        events: [
          { id: "call", kind: "assistant-tool-call", content: "call" },
          { id: "approval", kind: "approval", content: "allow" },
          { id: "result", kind: "tool-result", content: "result" },
        ],
      },
      {
        id: "message",
        classification: "internal",
        events: [{ id: "message", kind: "message", content: "next" }],
      },
    ];
    const result = await compactCausalBlocks(blocks, 1, async () => "summary");
    expect(result.compactedBlockIds).toEqual(["tool-block"]);
    expect(result.summary?.classification).toBe("confidential");
    expect(
      result.retained.some((block) =>
        block.events.some((event) => event.id === "approval")
      ),
    ).toBe(false);
  });
});
