import { describe, expect, test } from "bun:test";
import { encodeJson } from "../src/store/json.js";

describe("Effect SQL JSON parameters", () => {
  test("preserves JSON quotes around primitive strings", () => {
    expect(encodeJson("hello")).toBe("\"hello\"");
  });

  test("encodes structured values", () => {
    expect(encodeJson({ ok: true })).toBe("{\"ok\":true}");
  });

  test("rejects values JSON cannot represent", () => {
    expect(() => encodeJson(undefined)).toThrow(
      "cannot encode undefined as JSON",
    );
  });
});
