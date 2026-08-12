import { describe, expect, it } from "bun:test";
import { Component } from "../../src/core/component/component";
import { ComponentKindMismatchError } from "../../src/core/errors";
import type { ComponentContext, ComponentInstance } from "../../src/core/types";
import { makeInstance, makeManifest } from "../helpers";

class TestTool extends Component<"tool", Readonly<Record<string, never>>> {
  constructor(instance: ComponentInstance, context: ComponentContext) {
    super(instance, {}, context, "tool");
  }
}

describe("G1 kind integrity", () => {
  it("rejects a runtime kind that differs from the manifest", () => {
    const instance = makeInstance(makeManifest("skill"));
    const context = {
      scope: instance.scope,
      principal: instance.principal,
      snapshot: instance.snapshot,
    };
    expect(() => new TestTool(instance, context)).toThrow(
      ComponentKindMismatchError,
    );
  });

  it("exposes only scoped identity through ComponentContext", () => {
    const instance = makeInstance();
    const context = Object.freeze({
      scope: instance.scope,
      principal: instance.principal,
      snapshot: instance.snapshot,
    });
    const tool = new TestTool(instance, context);
    expect(tool.kind).toBe("tool");
    expect(
      Object.keys(context).sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      "principal",
      "scope",
      "snapshot",
    ]);
  });
});
