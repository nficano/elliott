import { describe, expect, it } from "bun:test";
import { componentRef } from "../../src/core/brands";
import { hashValue } from "../../src/core/digest";
import {
  assertCuratedEntriesValid,
  isCuratedEntryValid,
} from "../../src/memory/curated/index";
import type { CuratedMemoryEntry } from "../../src/memory/types";

const DOCUMENT = "MEMORY.md";
const CONTENT = "Repository uses Bun";
const PROVENANCE = { source: componentRef("workspace/tool/files") };
const CREATED_AT = "2026-01-01T00:00:00.000Z";

// Build an entry whose id is the honest content hash of its (possibly
// malformed) stamp, then optionally override the id to simulate tampering.
const entry = (
  stamp: { readonly classification?: string; readonly writtenUnder?: string; },
  idOverride?: string,
): CuratedMemoryEntry => {
  const fields = {
    document: DOCUMENT,
    content: CONTENT,
    stamp,
    provenance: PROVENANCE,
  };
  return {
    ...fields,
    id: idOverride ?? hashValue(fields),
    createdAt: CREATED_AT,
  } as unknown as CuratedMemoryEntry;
};

const validEntry = (): CuratedMemoryEntry =>
  entry({ classification: "internal", writtenUnder: "standard" });

describe("isCuratedEntryValid", () => {
  it("accepts an entry whose id matches its content hash", () => {
    expect(isCuratedEntryValid(validEntry())).toBe(true);
  });

  it("rejects an entry whose id was tampered with", () => {
    const tampered = entry(
      { classification: "internal", writtenUnder: "standard" },
      hashValue("not-the-real-content"),
    );
    expect(isCuratedEntryValid(tampered)).toBe(false);
  });

  it("rejects an unknown classification", () => {
    expect(
      isCuratedEntryValid(
        entry({ classification: "top-secret", writtenUnder: "standard" }),
      ),
    ).toBe(false);
  });

  it("rejects an unknown posture", () => {
    expect(
      isCuratedEntryValid(
        entry({ classification: "internal", writtenUnder: "yolo" }),
      ),
    ).toBe(false);
  });

  it("rejects a missing stamp", () => {
    const noStamp = {
      document: DOCUMENT,
      content: CONTENT,
      provenance: PROVENANCE,
      id: hashValue("x"),
      createdAt: CREATED_AT,
    } as unknown as CuratedMemoryEntry;
    expect(isCuratedEntryValid(noStamp)).toBe(false);
  });
});

describe("assertCuratedEntriesValid", () => {
  it("passes when every entry is valid", () => {
    expect(() => assertCuratedEntriesValid([validEntry(), validEntry()]))
      .not.toThrow();
  });

  it("passes on an empty list", () => {
    expect(() => assertCuratedEntriesValid([])).not.toThrow();
  });

  it("throws the loader tamper error on the first invalid entry", () => {
    const bad = entry(
      { classification: "internal", writtenUnder: "standard" },
      hashValue("tampered"),
    );
    expect(() => assertCuratedEntriesValid([validEntry(), bad])).toThrow(
      "Memory provider returned an invalid classification stamp",
    );
  });
});
