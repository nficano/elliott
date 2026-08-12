import { describe, expect, it } from "bun:test";
import { digest, scopeId } from "../../src/core/brands";
import {
  buildRecordEvent,
  MemoryRecordAppender,
} from "../../src/core/waist/records";
import type { RecordDraft } from "../../src/core/waist/types";

const draft = (
  payload?: Readonly<Record<string, unknown>>,
): RecordDraft => ({
  type: "turn.started",
  scope: { level: "session", id: scopeId("session") },
  durability: "observational",
  classification: "internal",
  payload: payload ?? { value: 1 },
});

describe("buildRecordEvent hash chain", () => {
  it("omits previousDigest and is deterministic for the first event", () => {
    const ctx = {
      id: "rec_1",
      timestamp: "2026-08-01T00:00:00.000Z",
      previousDigest: undefined,
    };
    const first = buildRecordEvent(draft(), ctx);
    expect(first).not.toHaveProperty("previousDigest");
    expect(first.id).toBe("rec_1");
    const again = buildRecordEvent(draft(), ctx);
    expect(again.digest).toBe(first.digest);
  });

  it("links event N to N-1 through previousDigest", () => {
    const first = buildRecordEvent(draft(), {
      id: "rec_1",
      timestamp: "t1",
      previousDigest: undefined,
    });
    const second = buildRecordEvent(draft({ value: 2 }), {
      id: "rec_2",
      timestamp: "t2",
      previousDigest: first.digest,
    });
    expect(second.previousDigest).toBe(first.digest);
    expect(second.digest).not.toBe(first.digest);
  });

  it("folds the chain head into the digest", () => {
    const withoutHead = buildRecordEvent(draft(), {
      id: "rec_1",
      timestamp: "t1",
      previousDigest: undefined,
    });
    const withHead = buildRecordEvent(draft(), {
      id: "rec_1",
      timestamp: "t1",
      previousDigest: digest("sha256:prior"),
    });
    expect(withHead.digest).not.toBe(withoutHead.digest);
    expect(withHead.previousDigest).toBe(digest("sha256:prior"));
  });
});

describe("MemoryRecordAppender external behavior", () => {
  it("chains appended events and advances the head", async () => {
    const appender = new MemoryRecordAppender();
    const one = await appender.append({
      ...draft(),
      id: "rec_1",
      timestamp: "t1",
    });
    const two = await appender.append({
      ...draft({ value: 2 }),
      id: "rec_2",
      timestamp: "t2",
    });
    expect(one).not.toHaveProperty("previousDigest");
    expect(two.previousDigest).toBe(one.digest);
    expect(appender.list().map((event) => event.id)).toEqual([
      "rec_1",
      "rec_2",
    ]);
  });

  it("matches buildRecordEvent given the same injected id/timestamp/head", async () => {
    const appender = new MemoryRecordAppender();
    const appended = await appender.append({
      ...draft(),
      id: "rec_1",
      timestamp: "t1",
    });
    const pure = buildRecordEvent(draft(), {
      id: "rec_1",
      timestamp: "t1",
      previousDigest: undefined,
    });
    expect(appended).toEqual(pure);
  });
});
