import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AuditLog,
  FileCommitAdapter,
  MemoryCommitAdapter,
} from "../../src/audit/index";
import { scopeId } from "../../src/core/brands";
import type { RecordEvent } from "../../src/core/waist/types";
import { AgentKernel } from "../../src/kernel";

// Records every batch the kernel commits so we can prove the injected adapter,
// not the hardcoded in-memory default, is the one receiving records.
class CapturingAdapter {
  readonly committed: RecordEvent[] = [];
  commit(batch: readonly RecordEvent[]): Promise<void> {
    this.committed.push(...batch);
    return Promise.resolve();
  }
}

const toolDraft = (type: string, payload: Record<string, unknown>) => ({
  type,
  scope: { level: "invocation" as const, id: scopeId("inv-1") },
  durability: "effect-gating" as const,
  classification: "internal" as const,
  payload,
});

describe("durable audit adapter", () => {
  it("routes kernel records through the injected adapter", async () => {
    const adapter = new CapturingAdapter();
    const kernel = new AgentKernel({ auditAdapter: adapter });
    await kernel.start();
    await kernel.stop();
    const types = adapter.committed.map((record) => record.type);
    expect(types).toContain("kernel.started");
  });

  it("persists committed records to an append-only file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "elliott-audit-"));
    const file = path.join(dir, "records.jsonl");
    const log = new AuditLog(new FileCommitAdapter(file));
    await log.append(toolDraft("tool.invocation", { tool: "ssh" }));
    await log.append(toolDraft("tool.invocation", { tool: "email" }));
    await log.crossLink();
    const lines = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RecordEvent);
    const tools = lines
      .filter((record) => record.type === "tool.invocation")
      .map((record) => record.payload["tool"]);
    expect(tools).toEqual(["ssh", "email"]);
    // The cross-link record is durably written too, sealing the shard heads.
    expect(lines.some((record) => record.type === "audit.crosslink")).toBe(
      true,
    );
  });

  it("verifies a clean chain and detects a tampered record", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    await log.append(toolDraft("tool.invocation", { n: 1 }));
    await log.append(toolDraft("tool.result", { n: 2 }));
    const clean = log.snapshot();
    expect(AuditLog.verify(clean).valid).toBe(true);

    const shardKey = Object.keys(clean.shards)[0] ?? "";
    const shard = clean.shards[shardKey] ?? [];
    const mutated = shard.map((record, index) =>
      index === 0 ? { ...record, payload: { n: 999 } } : record
    );
    const tampered = {
      shards: { [shardKey]: mutated },
      crossLinks: clean.crossLinks,
    };
    expect(AuditLog.verify(tampered).valid).toBe(false);
  });
});
