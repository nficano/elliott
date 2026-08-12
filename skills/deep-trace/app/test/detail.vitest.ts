import {
  classificationTone,
  detailLines,
  detailSummary,
  fmtNum,
  jsonSegments,
} from "#shared/utils/detail";
import {
  domainColor,
  hash01,
  hexRgb,
  shade,
} from "#shared/utils/palette";
import { describe, expect, it } from "vitest";

describe("fmtNum", () => {
  it("formats null and undefined as an em dash", () => {
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum()).toBe("—");
  });

  it("abbreviates thousands and millions", () => {
    expect(fmtNum(1500)).toBe("1.5k");
    expect(fmtNum(2_000_000, "B/s")).toBe("2.0MB/s");
  });

  it("rounds small values to two decimals", () => {
    expect(fmtNum(1.234_56)).toBe("1.23");
    expect(fmtNum(0.5, " cores")).toBe("0.5 cores");
  });
});

describe("classificationTone", () => {
  it("flags credential-bearing classes as danger", () => {
    expect(classificationTone("PII")).toBe("danger");
    expect(classificationTone("sensitive pii")).toBe("danger");
    expect(classificationTone("credentials")).toBe("danger");
  });

  it("flags financial as warn and the rest as neutral", () => {
    expect(classificationTone("financial")).toBe("warn");
    expect(classificationTone("operational-metadata")).toBe("");
  });
});

describe("jsonSegments", () => {
  it("reassembles to the pretty-printed JSON", () => {
    const value = { name: "elliott", port: 8080, live: true, note: null };
    const joined = jsonSegments(value).map((s) => s.text).join("");
    expect(joined).toBe(JSON.stringify(value, null, 2));
  });

  it("tags keys, strings, numbers, and booleans", () => {
    const tones = new Set(
      jsonSegments({ a: "x", b: 3, c: false }).map((s) => s.tone),
    );
    expect(tones.has("key")).toBe(true);
    expect(tones.has("string")).toBe(true);
    expect(tones.has("number")).toBe(true);
    expect(tones.has("boolean")).toBe(true);
  });
});

describe("detailSummary", () => {
  it("passes through primitives", () => {
    expect(detailSummary("plain")).toBe("plain");
    expect(detailSummary(7)).toBe("7");
    expect(detailSummary(null)).toBe("");
  });

  it("combines a label field with a body field", () => {
    expect(detailSummary({ id: "risk-1", mitigation: "sandbox" })).toBe(
      "risk-1: sandbox",
    );
  });

  it("falls back to flat key-value pairs", () => {
    expect(detailSummary({ alpha: 1, beta: "two" })).toBe(
      "alpha: 1 · beta: two",
    );
  });
});

describe("detailLines", () => {
  it("maps arrays to one line per item", () => {
    expect(detailLines(["a", "b"])).toEqual(["a", "b"]);
  });

  it("expands object arrays with the key as a prefix", () => {
    expect(detailLines({ concerns: ["x", "y"], state: "ok" })).toEqual([
      "concerns — x",
      "concerns — y",
      "state: ok",
    ]);
  });

  it("returns nothing for nullish values", () => {
    expect(detailLines(null)).toEqual([]);
    expect(detailLines()).toEqual([]);
  });
});

describe("palette", () => {
  it("parses hex colors", () => {
    expect(hexRgb("#35d6ff")).toEqual([0x35, 0xD6, 0xFF]);
  });

  it("lightens with positive factors and darkens with negative", () => {
    expect(shade("#000000", 1)).toBe("rgb(255,255,255)");
    expect(shade("#ffffff", -1)).toBe("rgb(0,0,0)");
    expect(shade("#35d6ff", 0, 0.5)).toBe("rgba(53,214,255,0.5)");
  });

  it("colors domains with the neon accents and falls back to cyan", () => {
    expect(domainColor({ domain: "agent-core" })).toBe("#39ff88");
    expect(domainColor({ domain: "unknown" })).toBe("#35d6ff");
  });

  it("hashes strings deterministically into [0, 1)", () => {
    expect(hash01("e.loop.prompt")).toBe(hash01("e.loop.prompt"));
    for (const id of ["a", "b", "edge:1"]) {
      const value = hash01(id);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
