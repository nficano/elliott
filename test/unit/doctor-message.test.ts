import { describe, expect, it } from "bun:test";
import {
  cleanMessage,
  dropCodeFrame,
  oneLine,
  redactSecrets,
  sanitizeForDisplay,
  stripUrlUserinfo,
} from "../../src/runtime/doctor/message";

describe("cleanMessage", () => {
  it("returns an Error's message, never its stack", () => {
    const error = new Error("something broke");
    expect(cleanMessage(error)).toBe("something broke");
    expect(cleanMessage(error)).not.toContain("at ");
  });

  it("stringifies a non-Error value", () => {
    expect(cleanMessage("plain")).toBe("plain");
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence of a known secret", () => {
    const out = redactSecrets("Bearer sk-secret-value / sk-secret-value", [
      "sk-secret-value",
    ]);
    expect(out).not.toContain("sk-secret-value");
    expect(out).toContain("‹redacted›");
  });

  it("redacts a realistic-length secret but skips a meaninglessly short one", () => {
    // A real credential (here 6 chars) is redacted; a one- or two-character
    // value is not — redacting it would blank a substring of ordinary words and
    // it is never a real key.
    expect(redactSecrets("provider echoed abc123", ["abc123"])).toBe(
      "provider echoed ‹redacted›",
    );
    expect(redactSecrets("Unknown key k here", ["k"])).toBe(
      "Unknown key k here",
    );
    expect(redactSecrets("blank is skipped", [" "])).toBe("blank is skipped");
  });

  it("ignores only undefined and empty secrets", () => {
    expect(redactSecrets("unchanged", [undefined, ""])).toBe("unchanged");
  });

  it("redacts the longest secret first so a prefix cannot leave a tail exposed", () => {
    const out = redactSecrets("provider echoed sk-supersecret", [
      "sk-",
      "sk-supersecret",
    ]);
    expect(out).toBe("provider echoed ‹redacted›");
    expect(out).not.toContain("supersecret");
  });
});

describe("dropCodeFrame", () => {
  it("keeps a single-line message intact", () => {
    expect(dropCodeFrame("Environment is missing ELLIOTT_LLM_PROVIDER")).toBe(
      "Environment is missing ELLIOTT_LLM_PROVIDER",
    );
  });

  it("drops a parser code frame (below a blank line), secret and all", () => {
    const parserError =
      "Nested mappings are not allowed at line 2:\n\n  api_key: sk-secret\n";
    expect(dropCodeFrame(parserError)).toBe(
      "Nested mappings are not allowed at line 2:",
    );
    expect(dropCodeFrame(parserError)).not.toContain("sk-secret");
  });

  it("keeps a value whose only newline is embedded, not a code frame", () => {
    // A single embedded newline (no blank line) is NOT a code frame: the whole
    // message survives for the caller to flatten, so nothing is truncated to a
    // misleading prefix.
    expect(dropCodeFrame("Unknown llm.provider: a\nb (expected x)")).toBe(
      "Unknown llm.provider: a\nb (expected x)",
    );
  });
});

describe("oneLine", () => {
  it("collapses newlines, tabs, and control bytes so no line can be forged", () => {
    const escape = String.fromCodePoint(0x1B);
    const del = String.fromCodePoint(0x7F);
    const out = oneLine(`401 error\nVERDICT: PASS\t${escape}[31m${del}red`);
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\t");
    expect(out).not.toContain(escape);
    expect(out).not.toContain(del);
    expect(out).toContain("VERDICT: PASS");
    expect(out.startsWith("401 error VERDICT: PASS")).toBe(true);
  });

  it("flattens Unicode line and format separators, not only C0 and DEL", () => {
    const lineSep = String.fromCodePoint(0x20_28);
    const paraSep = String.fromCodePoint(0x20_29);
    const nextLine = String.fromCodePoint(0x85);
    const zeroWidth = String.fromCodePoint(0x20_0B);
    const out = oneLine(
      `failure${lineSep}VERDICT: PASS${paraSep}b${nextLine}c${zeroWidth}d`,
    );
    for (const forbidden of [lineSep, paraSep, nextLine, zeroWidth]) {
      expect(out).not.toContain(forbidden);
    }
    expect(out).toBe("failure VERDICT: PASS b c d");
  });
});

describe("stripUrlUserinfo", () => {
  it("removes user:password from a URL", () => {
    expect(stripUrlUserinfo("https://user:password@example.com/v1")).toBe(
      "https://example.com/v1",
    );
  });

  it("returns a non-URL string unchanged", () => {
    expect(stripUrlUserinfo("not a url")).toBe("not a url");
  });
});

describe("sanitizeForDisplay", () => {
  it("scrubs the secret and flattens to a single line", () => {
    const out = sanitizeForDisplay("Bearer sk-secret-value\nVERDICT: PASS", [
      "sk-secret-value",
    ]);
    expect(out).not.toContain("sk-secret-value");
    expect(out).not.toContain("\n");
    expect(out).toBe("Bearer ‹redacted› VERDICT: PASS");
  });
});
