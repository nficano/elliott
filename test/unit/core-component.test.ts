import { describe, expect, it } from "bun:test";
import { Component } from "../../src/core/component/component";
import type { ComponentContext, ComponentInstance } from "../../src/core/types";
import { makeInstance, makeManifest, testProtocol } from "../helpers";

class TestTool extends Component<"tool", Readonly<Record<string, never>>> {
  constructor(instance: ComponentInstance, context: ComponentContext) {
    super(instance, {}, context, "tool");
  }
}

describe("Component base class", () => {
  it("exposes manifest helpers and kernel lifecycle hooks", async () => {
    const instance = makeInstance(
      makeManifest("tool", "workspace/tool/example", [], [testProtocol()]),
    );
    const context = Object.freeze({
      scope: instance.scope,
      principal: instance.principal,
      snapshot: instance.snapshot,
    });
    const tool = new TestTool(instance, context);
    expect(tool.manifest.ref).toBe(instance.manifest.ref);
    expect(tool.kind).toBe("tool");
    expect(tool.supports(testProtocol().id)).toBe(true);
    expect(tool.supports("missing" as never)).toBe(false);
    expect(tool.inspect("operator")).toMatchObject({
      ref: instance.manifest.ref,
      kind: "tool",
      view: "operator",
    });
    await tool.openForKernel();
    await tool.closeForKernel();
  });
});
