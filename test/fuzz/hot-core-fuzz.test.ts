import { describe, expect, it } from "bun:test";
import { LinearDfaScanner } from "../../src/hotcore/index";

describe("hot-core deterministic fuzz corpus", () => {
  it("matches whole-buffer scanning across every chunk boundary", () => {
    const patterns = ["secret", "token-value", "αβγ", "ababaca"];
    const corpus = [
      "prefix-secret-suffix",
      "token-value-at-start",
      "unicode-αβγ-value",
      "overlap-abababaca-end",
      "no matching bytes",
    ];
    for (const input of corpus) {
      const expected = new LinearDfaScanner(patterns).push(input);
      for (let split = 0; split <= input.length; split += 1) {
        const scanner = new LinearDfaScanner(patterns);
        const actual = [
          ...scanner.push(input.slice(0, split)),
          ...scanner.push(input.slice(split)),
        ];
        expect(actual).toEqual(expected);
      }
    }
  });
});
