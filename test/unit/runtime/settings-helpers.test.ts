import { describe, expect, it } from "bun:test";
import {
  optionalBooleanProperty,
  optionalNumberAt,
  optionalStringAt,
  optionalStringProperty,
  optionalValue,
  stringArrayAt,
  stringAt,
  valueAt,
} from "../../../src/runtime/settings";

describe("valueAt / stringAt", () => {
  it("walks nested records and stops on non-records", () => {
    expect(valueAt({ a: { b: 1 } }, ["a", "b"])).toBe(1);
    expect(valueAt({ a: "x" }, ["a", "b"])).toBeUndefined();
    expect(valueAt(null, ["a"])).toBeUndefined();
  });

  it("requires a non-empty string at the path", () => {
    expect(stringAt({ a: { b: "ok" } }, ["a", "b"])).toBe("ok");
    expect(() => stringAt({ a: { b: "" } }, ["a", "b"])).toThrow(
      /Missing configuration: a\.b/,
    );
    expect(() => stringAt({}, ["a", "b"])).toThrow(/Missing configuration/);
  });
});

describe("optional path helpers", () => {
  it("optionalStringAt ignores empty and non-strings", () => {
    expect(optionalStringAt({ a: "x" }, ["a"])).toBe("x");
    expect(optionalStringAt({ a: "" }, ["a"])).toBeUndefined();
    expect(optionalStringAt({ a: 1 }, ["a"])).toBeUndefined();
  });

  it("optionalNumberAt accepts only numbers", () => {
    expect(optionalNumberAt({ n: 3 }, ["n"])).toBe(3);
    expect(optionalNumberAt({ n: "3" }, ["n"])).toBeUndefined();
  });

  it("stringArrayAt filters non-strings and defaults missing", () => {
    expect(stringArrayAt({ a: ["x", 1, "y"] }, ["a"])).toEqual(["x", "y"]);
    expect(stringArrayAt({}, ["a"])).toEqual([]);
  });
});

describe("optional property helpers", () => {
  it("optionalValue omits empty and undefined", () => {
    expect(optionalValue("k", "v")).toEqual({ k: "v" });
    expect(optionalValue("k", "")).toEqual({});
    expect(optionalValue("k", undefined)).toEqual({});
  });

  it("optionalStringProperty / optionalBooleanProperty", () => {
    expect(optionalStringProperty("name", { a: "n" }, ["a"])).toEqual({
      name: "n",
    });
    expect(optionalStringProperty("name", {}, ["a"])).toEqual({});
    expect(optionalBooleanProperty("flag", { a: true }, ["a"])).toEqual({
      flag: true,
    });
    expect(optionalBooleanProperty("flag", { a: "true" }, ["a"])).toEqual({});
  });
});
