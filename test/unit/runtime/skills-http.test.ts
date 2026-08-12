import { describe, expect, it } from "bun:test";
import {
  constantTimeEqual,
  hmacSha256Hex,
  objectSchema,
  optionalInteger,
  publicUrl,
  requiredString,
  SIGNATURE_HEADER,
  stringValue,
  stripActiveHtml,
  verifiedRequestToken,
  verifiedSignatureHeader,
} from "../../../src/runtime/skills/http";

describe("runtime skills http helpers", () => {
  it.each(
    [
      ["https://example.com/path", "example.com"],
      ["https://docs.example.org", "docs.example.org"],
    ] as const,
  )("accepts public url %s", (value, host) => {
    expect(publicUrl(value).hostname).toBe(host);
  });

  it.each([
    "ftp://example.com",
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.1/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://169.254.1.1/x",
    "https://user:pass@example.com",
    "https://host.local/x",
  ])("rejects non-public url %s", (value) => {
    expect(() => publicUrl(value)).toThrow();
  });

  it("compares tokens and signatures safely", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    const secret = "webhook-secret";
    const body = "{\"ok\":true}";
    const signature = hmacSha256Hex(secret, body);
    expect(
      verifiedSignatureHeader(
        new Request("https://agent.test", {
          headers: { [SIGNATURE_HEADER]: signature },
        }),
        body,
        secret,
      ),
    ).toBe(true);
    expect(
      verifiedSignatureHeader(
        new Request("https://agent.test"),
        body,
        secret,
      ),
    ).toBe(false);
    expect(
      verifiedRequestToken(
        new Request(`https://agent.test/?token=${secret}`),
        secret,
      ),
    ).toBe(true);
    expect(
      verifiedRequestToken(new Request("https://agent.test/"), secret),
    ).toBe(false);
  });

  it("parses tool argument helpers and strips active HTML", () => {
    expect(objectSchema({ name: { type: "string" } }, ["name"])).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(requiredString({ value: "ok" }, "value")).toBe("ok");
    expect(() => requiredString({ value: 1 }, "value")).toThrow(
      "must be a string",
    );
    expect(optionalInteger({ n: 3.9 }, "n", { min: 1, max: 10, fallback: 0 }))
      .toBe(3);
    expect(optionalInteger({}, "n", { min: 1, max: 10, fallback: 7 })).toBe(7);
    expect(optionalInteger({ n: 99 }, "n", { min: 1, max: 10, fallback: 0 }))
      .toBe(10);
    expect(stringValue("x")).toBe("x");
    expect(stringValue(1)).toBe("");
    expect(stripActiveHtml("<script>alert(1)</script><b>Hi</b> there")).toBe(
      "Hi there",
    );
  });
});
