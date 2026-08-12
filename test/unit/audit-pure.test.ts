import { describe, expect, it } from "bun:test";
import { AuditLog, buildCrossLink } from "../../src/audit/log";
import { auditShardKey, createAuditRecord } from "../../src/audit/shards/index";
import type { AuditCrossLink, AuditSnapshot } from "../../src/audit/types";
import { scopeId } from "../../src/core/brands";
import type { Scope } from "../../src/core/types";
import type { RecordDraft, RecordEvent } from "../../src/core/waist/types";

const SCOPE: Scope = { level: "session", id: scopeId("s") };
const TS_A = "2026-01-01T00:00:00.000Z";
const TS_B = "2026-01-02T00:00:00.000Z";

const draft = (id: string, n: number): RecordDraft => ({
  id,
  type: "model.selection",
  scope: SCOPE,
  durability: "observational",
  classification: "internal",
  timestamp: TS_A,
  payload: { n },
});

const KEY = auditShardKey(draft("rec_1", 1));
const r1 = createAuditRecord(draft("rec_1", 1));
const r2 = createAuditRecord(draft("rec_2", 2), r1.digest);
const r3 = createAuditRecord(draft("rec_3", 3), r2.digest);

const build = (
  records: readonly RecordEvent[],
  previousLink: AuditCrossLink | undefined,
  id: string,
  timestamp: string,
): AuditCrossLink =>
  buildCrossLink({
    shards: new Map<string, RecordEvent[]>([[KEY, [...records]]]),
    previousLink,
    id,
    timestamp,
  });

describe("buildCrossLink", () => {
  it("is deterministic for fixed shards, id and timestamp", () => {
    const first = build([r1, r2], undefined, "cl_1", TS_A);
    const second = build([r1, r2], undefined, "cl_1", TS_A);
    expect(second).toEqual(first);
  });

  it("changes the digest when the id or timestamp changes", () => {
    const base = build([r1, r2], undefined, "cl_1", TS_A);
    const otherId = build([r1, r2], undefined, "cl_2", TS_A);
    const otherTs = build([r1, r2], undefined, "cl_1", TS_B);
    expect(otherId.digest).not.toBe(base.digest);
    expect(otherTs.digest).not.toBe(base.digest);
  });

  it("records each non-empty shard's head digest and length", () => {
    const link = build([r1, r2], undefined, "cl_1", TS_A);
    expect(link.shardHeads[KEY]).toBe(r2.digest);
    expect(link.shardLengths[KEY]).toBe(2);
    expect(link.previousRoot).toBeUndefined();
  });

  it("skips shards with no records", () => {
    const link = buildCrossLink({
      shards: new Map<string, RecordEvent[]>([[KEY, []]]),
      previousLink: undefined,
      id: "cl_1",
      timestamp: TS_A,
    });
    expect(link.shardHeads).toEqual({});
    expect(link.shardLengths).toEqual({});
  });

  it("chains previousRoot to the prior link's digest", () => {
    const first = build([r1, r2], undefined, "cl_1", TS_A);
    const second = build([r1, r2, r3], first, "cl_2", TS_B);
    expect(second.previousRoot).toBe(first.digest);
  });

  it("produces links AuditLog.verify accepts (single link round trip)", () => {
    const link = build([r1, r2], undefined, "cl_1", TS_A);
    const snapshot: AuditSnapshot = {
      shards: { [KEY]: [r1, r2] },
      crossLinks: [link],
    };
    expect(AuditLog.verify(snapshot)).toEqual({ valid: true, errors: [] });
  });

  it("produces a chained pair AuditLog.verify accepts", () => {
    const first = build([r1, r2], undefined, "cl_1", TS_A);
    const second = build([r1, r2, r3], first, "cl_2", TS_B);
    const snapshot: AuditSnapshot = {
      shards: { [KEY]: [r1, r2, r3] },
      crossLinks: [first, second],
    };
    expect(AuditLog.verify(snapshot).valid).toBe(true);
  });
});
