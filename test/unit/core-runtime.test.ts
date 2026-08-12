import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import {
  LifecycleTransitionError,
  SchemaResolutionError,
} from "../../src/core/errors";
import { ManagedComponentInstance } from "../../src/core/instance/instance";
import { ComponentSchemaRegistry } from "../../src/core/schema/schema";
import { SnapshotStore } from "../../src/core/snapshot/snapshot";
import { makeInstance, makeManifest, makeSchema } from "../helpers";

describe("M0 runtime", () => {
  it("enforces lifecycle transitions and releases terminal grants", async () => {
    let releases = 0;
    const managed = new ManagedComponentInstance(makeInstance(), {
      open: async () => undefined,
      close: async () => undefined,
      releaseGrant: async () => {
        releases += 1;
      },
    });
    await managed.open();
    await managed.close();
    expect(managed.state).toBe("closed");
    expect(managed.view().released).toBe(true);
    expect(releases).toBe(1);
    await expect(managed.close()).rejects.toBeInstanceOf(
      LifecycleTransitionError,
    );
  });

  it("fails unresolved schemas and enforces their isolation floor", () => {
    const schemas = new ComponentSchemaRegistry();
    const manifest = makeManifest();
    expect(() => schemas.resolve(manifest.schema)).toThrow(
      SchemaResolutionError,
    );
    schemas.register(makeSchema("tool", "container"));
    expect(() => schemas.validateManifest(manifest, "process")).toThrow();
  });

  it("creates different deeply immutable snapshots for different configs", () => {
    const store = new SnapshotStore();
    const first = store.create({
      configurationDigest: digest("config:a"),
      registryDigest: digest("registry"),
      components: [],
      configuration: { nested: { value: "a" } },
    });
    const second = store.create({
      configurationDigest: digest("config:b"),
      registryDigest: digest("registry"),
      components: [],
      configuration: { nested: { value: "b" } },
      previous: first.id,
    });
    expect(second.id).not.toBe(first.id);
    expect(Object.isFrozen(first.configuration)).toBe(true);
    expect(Object.isFrozen(first.configuration.nested)).toBe(true);
  });
});
