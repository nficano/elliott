import { describe, expect, it } from "bun:test";
import { componentRef, principalId } from "../../src/core/brands";
import {
  CuratedMemoryStore,
  InMemoryCuratedPersistence,
} from "../../src/memory/curated/index";
import { ExternalMemorySlot } from "../../src/memory/external-slot/index";
import { SessionStore } from "../../src/memory/session-store/index";

describe("Phase 2 memory providers", () => {
  it("freezes curated memory per session while writes remain durable", async () => {
    const persistence = new InMemoryCuratedPersistence();
    const store = new CuratedMemoryStore({
      maximumCharacters: { "MEMORY.md": 1000, "USER.md": 1000 },
      posture: () => "regulated",
      persistence,
    });
    await store.initialize();
    await store.mutate({
      action: "add",
      document: "USER.md",
      content: "Prefers concise answers",
      classification: "confidential",
      provenance: { source: componentRef("workspace/gateway/cli") },
    });
    const first = store.beginSession("one");
    await store.mutate({
      action: "add",
      document: "MEMORY.md",
      content: "Repository uses Bun",
      classification: "internal",
      provenance: { source: componentRef("workspace/tool/files") },
    });
    expect(first.prefix).not.toContain("Repository uses Bun");
    expect(store.beginSession("two").prefix).toContain("Repository uses Bun");
    expect(store.list().map((entry) => entry.stamp.classification)).toEqual([
      "confidential",
      "internal",
    ]);
  });

  it("uses one WAL/FTS system of record for recall and analytics", () => {
    const store = new SessionStore();
    store.createSession({
      id: "session",
      source: "cli",
      principal: principalId("principal"),
      createdAt: new Date().toISOString(),
    });
    store.appendMessage({
      id: "message",
      sessionId: "session",
      role: "user",
      content: "searchable memory entry",
      classification: "internal",
      createdAt: new Date().toISOString(),
    });
    store.recordUsage({
      sessionId: "session",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    });
    expect(store.search("searchable")[0]?.id).toBe("message");
    expect(store.analytics()).toMatchObject({
      sessions: 1,
      messages: 1,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    });
    store.close();
  });

  it("enforces the single external semantic-memory slot", () => {
    const provider = {
      ref: componentRef("workspace/memory/external"),
      async initialize() {},
      async systemPromptBlock() {
        return "";
      },
      async prefetch() {
        return [];
      },
      async syncTurn() {},
      async onPreCompress() {},
      async onSessionEnd() {},
      toolSchemas() {
        return [];
      },
    };
    const slot = new ExternalMemorySlot();
    slot.register(provider);
    expect(() => slot.register(provider)).toThrow("Only one");
  });
});
