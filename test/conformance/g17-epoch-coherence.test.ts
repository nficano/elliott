import { describe, expect, it } from "bun:test";
import { digest, epoch } from "../../src/core/brands";
import { VersionedCache } from "../../src/core/cache/versioned";
import { EpochRegistry } from "../../src/core/epoch/epochs";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import type { RecordDraft, RecordEvent } from "../../src/core/waist/types";
import { zeroEpochVector } from "../helpers";

class ObservingAppender extends MemoryRecordAppender {
  observe: () => number = () => -1;
  observed = -1;

  override async append(draft: RecordDraft): Promise<RecordEvent> {
    this.observed = this.observe();
    return super.append(draft);
  }
}

describe("G17 epoch coherence", () => {
  it("makes an epoch-bump record durable before publishing the new counter", async () => {
    const records = new ObservingAppender();
    const epochs = new EpochRegistry(records);
    records.observe = () => epochs.current("session", "s1");
    await epochs.bump("session", "s1", "revocation");
    expect(records.observed).toBe(0);
    expect(epochs.current("session", "s1")).toBe(1);
    expect(epochs.reader()).not.toHaveProperty("bump");
  });

  it("recomputes stale and corrupted versioned entries", async () => {
    const cache = new VersionedCache<number>({
      is: (value): value is number => typeof value === "number",
      digest: (value) => digest(`value:${value}`),
    });
    const stamp = { epochs: zeroEpochVector(), digests: [digest("policy:v1")] };
    let recomputes = 0;
    const first = await cache.resolve("decision", stamp, async () => {
      recomputes += 1;
      return 1;
    });
    expect(first.source).toBe("miss");
    cache.putUnsafeForTest("decision", {
      key: "decision",
      stamp,
      value: 99,
      valueDigest: digest("corrupt"),
    });
    const repaired = await cache.resolve("decision", stamp, async () => {
      recomputes += 1;
      return 2;
    });
    expect(repaired).toEqual({ value: 2, source: "corrupt" });
    const stale = await cache.resolve(
      "decision",
      {
        epochs: { ...zeroEpochVector(), session: epoch(1) },
        digests: [digest("policy:v1")],
      },
      async () => {
        recomputes += 1;
        return 3;
      },
    );
    expect(stale).toEqual({ value: 3, source: "stale" });
    expect(recomputes).toBe(3);
  });
});
