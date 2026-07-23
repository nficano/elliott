import { describe, expect, it } from "bun:test";
import { componentRef } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import {
  CuratedMemoryStore,
  InMemoryCuratedPersistence,
} from "../../src/memory/curated/index";
import { KernelContextManager } from "../../src/security/ifc/context-manager";

describe("G7 memory classification round-trip", () => {
  it("raises a later frame to the immutable stored stamp", async () => {
    const persistence = new InMemoryCuratedPersistence();
    const store = new CuratedMemoryStore({
      maximumCharacters: { "MEMORY.md": 1000, "USER.md": 1000 },
      posture: () => "regulated",
      persistence,
    });
    await store.initialize();
    const entry = await store.mutate({
      action: "add",
      document: "MEMORY.md",
      content: "restricted fact",
      classification: "restricted",
      provenance: { source: componentRef("workspace/memory/source") },
    });
    expect(entry?.stamp.classification).toBe("restricted");
    const frames = new KernelContextManager(
      new MemoryRecordAppender(),
      {
        async sanitize() {
          return { approved: false };
        },
      },
      false,
    );
    const frame = frames.activeFrame;
    frames.wire({
      frame,
      messages: [{ role: "system", content: entry?.content ?? "" }],
      tags: [],
      sourceClassification: entry?.stamp.classification ?? "restricted",
    });
    expect(frames.frame(frame).classification).toBe("restricted");
  });
});
