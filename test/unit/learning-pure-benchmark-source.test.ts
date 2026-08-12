import { describe, expect, it } from "bun:test";
import { parseBenchmarkSourceSpecification } from "../../src/learning/evolution/application/dataset-sources";

const REF_REQUIRED_ERROR =
  "benchmark source requires benchmark:<ref>#<task-id,...>";

describe("parseBenchmarkSourceSpecification", () => {
  it("defaults to a bootstrap task when no tasks are named", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:foo");
    expect(result).toEqual({ benchmarkRef: "foo", taskIds: ["bootstrap"] });
  });

  it("parses a comma-separated task list", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:foo#a,b");
    expect(result).toEqual({ benchmarkRef: "foo", taskIds: ["a", "b"] });
  });

  it("trims whitespace and drops empty task ids", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:foo# a , ,b ");
    expect(result).toEqual({ benchmarkRef: "foo", taskIds: ["a", "b"] });
  });

  it("defaults to bootstrap when the task list is empty after filtering", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:foo#, ,");
    expect(result).toEqual({ benchmarkRef: "foo", taskIds: ["bootstrap"] });
  });

  it("errors when the benchmark ref is empty", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:");
    expect(result).toEqual({ error: REF_REQUIRED_ERROR });
  });

  it("errors when the ref is empty but tasks are present", () => {
    const result = parseBenchmarkSourceSpecification("benchmark:#a,b");
    expect(result).toEqual({ error: REF_REQUIRED_ERROR });
  });
});
