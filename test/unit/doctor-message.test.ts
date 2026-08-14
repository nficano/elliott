import { describe, expect, it } from "bun:test";
import {
  cleanMessage,
  dropCodeFrame,
  flattenLine,
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

  it("redacts a recorded secret of any non-empty length, short ones included", () => {
    // The redaction set holds only resolved SECRETS (the non-secret LLM config
    // vars are skip-listed before recording), so a short recorded value is a real
    // credential and is scrubbed regardless of length — a PIN or a brief token is
    // still a secret. Length is not a licence to print it.
    expect(redactSecrets("provider echoed abc123", ["abc123"])).toBe(
      "provider echoed ‹redacted›",
    );
    expect(redactSecrets("skill echoed abc", ["abc"])).toBe(
      "skill echoed ‹redacted›",
    );
    expect(redactSecrets("pin is 12", ["12"])).toBe("pin is ‹redacted›");
  });

  it("skips only values with nothing to replace (undefined, empty, whitespace)", () => {
    // A trimmed-empty value would match everywhere and hide nothing real; it is
    // the only "meaningless replacement" case.
    expect(redactSecrets("unchanged", [undefined, ""])).toBe("unchanged");
    expect(redactSecrets("blank is skipped", [" "])).toBe("blank is skipped");
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
  it("removes user:password from a bare URL", () => {
    expect(stripUrlUserinfo("https://user:password@example.com/v1")).toBe(
      "https://example.com/v1",
    );
  });

  it("removes userinfo from a URL embedded in a longer message", () => {
    // The credential may be inline in a skill's error text; a base_url is
    // non-secret by name so no recorded secret would match it.
    expect(
      stripUrlUserinfo(
        "skill failed at https://user:password@example.com/v1 now",
      ),
    ).toBe("skill failed at https://example.com/v1 now");
  });

  it("strips bare user@ userinfo too", () => {
    expect(stripUrlUserinfo("postgres://admin@db.internal/app")).toBe(
      "postgres://db.internal/app",
    );
  });

  it("removes userinfo up to the LAST @ when the password contains @", () => {
    // URL parsing uses the last @ of the authority as the delimiter, so a
    // password may itself contain @; stopping at the first @ would leak a suffix.
    expect(stripUrlUserinfo("failed at https://user:p@ss@example.com/v1")).toBe(
      "failed at https://example.com/v1",
    );
  });

  it("does not treat an @ in the path as userinfo", () => {
    expect(stripUrlUserinfo("https://example.com/u@x")).toBe(
      "https://example.com/u@x",
    );
  });

  it("returns a non-URL string unchanged", () => {
    expect(stripUrlUserinfo("not a url")).toBe("not a url");
  });
});

describe("flattenLine", () => {
  it("replaces line-forging characters with a space but preserves indentation", () => {
    expect(flattenLine("  - bad\nVERDICT: PASS")).toBe("  - bad VERDICT: PASS");
  });

  it("flattens Unicode line separators too, without collapsing ordinary spaces", () => {
    const lineSep = String.fromCodePoint(0x20_28);
    expect(flattenLine(`  + a${lineSep}b   c`)).toBe("  + a b   c");
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
