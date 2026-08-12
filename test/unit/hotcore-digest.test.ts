import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import {
  auditChainLink,
  Sha256IncrementalDigest,
  TypeScriptLinearDfaScanner,
} from "../../src/hotcore/index";

describe("hotcore digest and scanner edges", () => {
  it("resets scanners and finalizes digests once", () => {
    const scanner = new TypeScriptLinearDfaScanner(["ab", "aa"]);
    expect(scanner.push("aaab").map((match) => match.pattern)).toEqual([
      "aa",
      "aa",
      "ab",
    ]);
    scanner.reset();
    expect(scanner.push("ab")).toEqual([{ pattern: "ab", endOffset: 2 }]);

    const hasher = new Sha256IncrementalDigest();
    hasher.update("hello");
    const value = hasher.digest();
    expect(value.startsWith("sha256:")).toBe(true);
    expect(() => hasher.update("more")).toThrow("already finalized");
    expect(() => hasher.digest()).toThrow("already finalized");
    expect(auditChainLink(undefined, { n: 1 })).not.toBe(
      auditChainLink(digest("sha256:prev"), { n: 1 }),
    );
  });

  it("rejects empty scanner patterns", () => {
    expect(() => new TypeScriptLinearDfaScanner([""])).toThrow("empty");
  });
});
