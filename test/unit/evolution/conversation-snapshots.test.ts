import { describe, expect, it } from "bun:test";
import { RuntimeConversationSnapshots } from "../../../src/runtime/conversation-snapshots";

describe("runtime conversation Snapshot pinning", () => {
  it("keeps an existing conversation on its original immutable Snapshot", () => {
    const snapshots = new RuntimeConversationSnapshots();
    expect(snapshots.resolve("existing", "snapshot:one", true)).toBe(
      "snapshot:one",
    );
    expect(snapshots.resolve("existing", "snapshot:two", true)).toBe(
      "snapshot:one",
    );
    expect(snapshots.resolve("new", "snapshot:two", true)).toBe(
      "snapshot:two",
    );
  });

  it("uses current bytes for externally managed history", () => {
    const snapshots = new RuntimeConversationSnapshots();
    expect(snapshots.resolve("external", "snapshot:one", false)).toBe(
      "snapshot:one",
    );
    expect(snapshots.resolve("external", "snapshot:two", false)).toBe(
      "snapshot:two",
    );
  });
});
