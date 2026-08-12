import { describe, expect, it } from "bun:test";
import { makeRedactor, redactPatterns } from "../../../src/runtime/redaction";

describe("redactPatterns (shape-based, no configuration)", () => {
  it("strips HashiCorp Vault tokens (service/batch/recovery)", () => {
    const out = redactPatterns(
      "auth failed with hvs.CAESABC-123 and hvb.deadBEEF_9 and hvr.xyz.42",
    );
    expect(out).not.toContain("hvs.CAESABC-123");
    expect(out).not.toContain("hvb.deadBEEF_9");
    expect(out).not.toContain("hvr.xyz.42");
  });

  it("strips URL userinfo (a DSN public key / user:pass@host)", () => {
    const out = redactPatterns(
      "posting to https://leakykey@sentry.example/1 failed",
    );
    expect(out).not.toContain("leakykey");
    expect(out).not.toContain("sentry.example");
    expect(out).toContain("posting to");
    expect(out).toContain("failed");
  });

  it("leaves ordinary error text untouched", () => {
    for (
      const clean of ["upstream 500", "no host", "boom", "connection reset"]
    ) {
      expect(redactPatterns(clean)).toBe(clean);
    }
  });

  it("does not eat ordinary prose that merely contains 's.'", () => {
    // The legacy-token pattern is length-gated, so this is not redacted.
    expect(redactPatterns("see items.list for details")).toBe(
      "see items.list for details",
    );
  });
});

describe("makeRedactor (exact secret values + shapes)", () => {
  it("strips the exact configured DSN, Vault token, and Vault paths", () => {
    const redact = makeRedactor([
      "http://elliott@127.0.0.1:9080/1",
      "hvs.CONFIGUREDTOKEN",
      "secret/data/private",
    ]);
    const out = redact(
      "Vault read of secret/data/private with hvs.CONFIGUREDTOKEN "
        + "against http://elliott@127.0.0.1:9080/1 failed",
    );
    expect(out).not.toContain("secret/data/private");
    expect(out).not.toContain("hvs.CONFIGUREDTOKEN");
    expect(out).not.toContain("127.0.0.1:9080");
    expect(out).toContain("Vault read of");
  });

  it("ignores too-short literals so a message is not shredded", () => {
    const redact = makeRedactor(["ab", ""]);
    expect(redact("a stable readable message ab")).toBe(
      "a stable readable message ab",
    );
  });

  it("still applies shape patterns for secrets it was not seeded with", () => {
    const redact = makeRedactor(["secret/data/known"]);
    // hvs.* is caught by pattern even though it was never seeded.
    expect(redact("token hvs.UNSEEDEDvalue123")).not.toContain(
      "hvs.UNSEEDEDvalue123",
    );
  });
});
