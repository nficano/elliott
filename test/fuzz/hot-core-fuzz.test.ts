import { describe, expect, it } from "bun:test";
import {
  createNativeScanner,
  LinearDfaScanner,
  TypeScriptLinearDfaScanner,
} from "../../src/hotcore/index";

const chunkBoundaries = (input: string): readonly number[] => {
  const boundaries = [0];
  let offset = 0;
  for (const character of input) {
    offset += character.length;
    boundaries.push(offset);
  }
  return boundaries;
};

describe("hot-core deterministic fuzz corpus", () => {
  it("matches the TypeScript reference across every chunk boundary", () => {
    const patterns = [
      "secret",
      "ret",
      "ret",
      "token-value",
      "αβγ",
      "ababaca",
      "💥é",
    ];
    const corpus = [
      "prefix-secret-suffix",
      "token-value-at-start",
      "unicode-αβγ-value",
      "overlap-abababaca-end",
      "astral-💥é-value",
      "no matching bytes",
    ];
    for (const input of corpus) {
      const expected = new TypeScriptLinearDfaScanner(patterns).push(input);
      for (const split of chunkBoundaries(input)) {
        const scanner = new LinearDfaScanner(patterns);
        const actual = [
          ...scanner.push(input.slice(0, split)),
          ...scanner.push(input.slice(split)),
        ];
        expect(actual).toEqual([...expected]);
      }
    }
  });

  it("reports overlapping patterns and resets offsets", () => {
    const scanner = new LinearDfaScanner(["aba", "ba", "a"]);
    expect(scanner.push("ababa")).toEqual([
      { pattern: "a", endOffset: 1 },
      { pattern: "aba", endOffset: 3 },
      { pattern: "ba", endOffset: 3 },
      { pattern: "a", endOffset: 3 },
      { pattern: "aba", endOffset: 5 },
      { pattern: "ba", endOffset: 5 },
      { pattern: "a", endOffset: 5 },
    ]);
    scanner.reset();
    expect(scanner.push("aba").at(-1)?.endOffset).toBe(3);
  });

  it("rejects empty patterns", () => {
    expect(() => new LinearDfaScanner([""])).toThrow(
      "patterns cannot be empty",
    );
  });

  it("matches the TypeScript reference through the native adapter", () => {
    const patterns = ["secret", "ret", "ret", "αβγ", "💥é"];
    const native = createNativeScanner(patterns);
    if (native === undefined) return;
    const reference = new TypeScriptLinearDfaScanner(patterns);
    const chunks = ["pre-sec", "ret-α", "βγ-💥", "é"];
    for (const chunk of chunks) {
      expect(native.push(chunk)).toEqual(reference.push(chunk));
    }
  });
});
