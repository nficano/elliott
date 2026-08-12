import { describe, expect, it } from "bun:test";
import type { DataClassification } from "../../src/core/types";
import {
  requiresDeclassification,
  resolveMergeOrdering,
} from "../../src/security/ifc/context-manager";

const ORDER: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const SAME_REVISION = 3;
const STALE_REVISION = 2;

describe("requiresDeclassification", () => {
  it("holds exactly when the source outranks the target (down-step)", () => {
    for (const source of ORDER) {
      for (const target of ORDER) {
        const expected = ORDER.indexOf(source) > ORDER.indexOf(target);
        expect(requiresDeclassification(source, target)).toBe(expected);
      }
    }
  });

  it("is false for equal classifications", () => {
    for (const level of ORDER) {
      expect(requiresDeclassification(level, level)).toBe(false);
    }
  });

  it("is false for an up-step", () => {
    expect(requiresDeclassification("internal", "confidential")).toBe(false);
  });

  it("is true for a strict down-step", () => {
    expect(requiresDeclassification("restricted", "public")).toBe(true);
  });
});

describe("resolveMergeOrdering", () => {
  it("stays commutative when declared commutative and append-safe", () => {
    expect(
      resolveMergeOrdering("commutative", true, {
        source: STALE_REVISION,
        current: SAME_REVISION,
      }),
    ).toBe("commutative");
  });

  it("degrades to revision-dependent when not append-safe", () => {
    expect(
      resolveMergeOrdering("commutative", false, {
        source: SAME_REVISION,
        current: SAME_REVISION,
      }),
    ).toBe("revision-dependent");
  });

  it("is revision-dependent when the ordering is revision-dependent", () => {
    expect(
      resolveMergeOrdering("revision-dependent", true, {
        source: SAME_REVISION,
        current: SAME_REVISION,
      }),
    ).toBe("revision-dependent");
  });

  it("is stale when revision-dependent and revisions diverge", () => {
    expect(
      resolveMergeOrdering("revision-dependent", false, {
        source: STALE_REVISION,
        current: SAME_REVISION,
      }),
    ).toBe("stale");
  });

  it("never goes stale while effectively commutative", () => {
    expect(
      resolveMergeOrdering("commutative", true, {
        source: STALE_REVISION,
        current: SAME_REVISION,
      }),
    ).not.toBe("stale");
  });
});
