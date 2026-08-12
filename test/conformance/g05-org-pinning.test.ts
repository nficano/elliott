import { describe, expect, it } from "bun:test";
import { scopeId } from "../../src/core/brands";
import {
  PinnedShadowError,
  RegistryCollisionError,
} from "../../src/core/errors";
import { ComponentRegistry } from "../../src/core/registry/registry";
import { makeManifest } from "../helpers";

describe("G5 org pinning", () => {
  it("fails closed when a narrower scope shadows security-critical policy", () => {
    const registry = new ComponentRegistry();
    const policy = makeManifest("policy", "organization/policy/baseline");
    registry.register(policy, {
      scope: { level: "organization", id: scopeId("org") },
    });
    registry.register(policy, {
      scope: { level: "workspace", id: scopeId("workspace") },
    });
    expect(() => registry.resolve(policy.ref)).toThrow(PinnedShadowError);
  });

  it("rejects same-scope collisions and records legitimate shadowing", () => {
    const registry = new ComponentRegistry();
    const tool = makeManifest("tool", "workspace/tool/example");
    registry.register(tool, {
      scope: { level: "builtin", id: scopeId("builtin") },
    });
    registry.register(tool, {
      scope: { level: "workspace", id: scopeId("workspace") },
    });
    expect(registry.resolve(tool.ref)?.selected.scope.level).toBe("workspace");
    expect(registry.lockfile()[0]?.shadowedScopes[0]?.level).toBe("builtin");
    expect(() =>
      registry.register(tool, {
        scope: { level: "workspace", id: scopeId("workspace") },
      })
    ).toThrow(RegistryCollisionError);
  });
});
