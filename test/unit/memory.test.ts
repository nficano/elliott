import { describe, expect, it } from "bun:test";
import { componentRef, digest, principalId } from "../../src/core/brands";
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

  it("delegates external-slot lifecycle and rejects bad companions", async () => {
    const calls: string[] = [];
    const provider = {
      ref: componentRef("workspace/memory/external"),
      async initialize() {
        calls.push("initialize");
      },
      async systemPromptBlock() {
        calls.push("system");
        return "block";
      },
      async prefetch(query: string) {
        calls.push(`prefetch:${query}`);
        return [];
      },
      async syncTurn(sessionId: string) {
        calls.push(`sync:${sessionId}`);
      },
      async onPreCompress(sessionId: string) {
        calls.push(`pre:${sessionId}`);
      },
      async onSessionEnd(sessionId: string) {
        calls.push(`end:${sessionId}`);
      },
      toolSchemas() {
        calls.push("schemas");
        return [{ name: "memory_search" }];
      },
    };
    const empty = new ExternalMemorySlot();
    expect(empty.active).toBeUndefined();
    expect(() => empty.initialize()).toThrow("No external memory");
    const slot = new ExternalMemorySlot();
    slot.register(provider);
    expect(slot.active?.ref).toBe(provider.ref);
    await slot.initialize();
    expect(await slot.systemPromptBlock()).toBe("block");
    expect(await slot.prefetch("q")).toEqual([]);
    await slot.syncTurn("s1");
    await slot.onPreCompress("s1");
    await slot.onSessionEnd("s1");
    expect(slot.toolSchemas()).toEqual([{ name: "memory_search" }]);
    slot.clear();
    expect(slot.active).toBeUndefined();
    expect(calls).toEqual([
      "initialize",
      "system",
      "prefetch:q",
      "sync:s1",
      "pre:s1",
      "end:s1",
      "schemas",
    ]);
    expect(() =>
      new ExternalMemorySlot().register({
        ...provider,
        companion: {
          name: "memory",
          image: "memory:latest",
          egress: { kind: "declared", hosts: ["example.com"] },
          endpoint: "http://127.0.0.1:9",
          tmpfs: [],
          secretRefs: [],
          manifestDigest: digest("sha256:companion"),
        },
      })
    ).toThrow("none egress");
  });
});
