import { describe, expect, it } from "bun:test";
import { componentRef, scopeId } from "../../src/core/brands";
import { PinnedShadowError } from "../../src/core/errors";
import { resolveEntries } from "../../src/core/registry/registry";
import type { RegistryEntry } from "../../src/core/registry/types";
import type { ComponentKind, ScopeLevel } from "../../src/core/types";
import { makeManifest } from "../helpers";

const ref = componentRef("workspace/tool/target");

const entry = (
  level: ScopeLevel,
  options: { readonly kind?: ComponentKind; readonly pinned?: boolean; } = {},
): RegistryEntry => {
  const kind = options.kind ?? "tool";
  return {
    manifest: makeManifest(kind, `${level}/${kind}/x`),
    scope: { level, id: scopeId(level) },
    availability: "available",
    pinned: options.pinned ?? false,
  };
};

describe("resolveEntries scope precedence", () => {
  it("resolves an empty entry list to undefined", () => {
    expect(resolveEntries(ref, [])).toBeUndefined();
  });

  it("selects the highest-precedence scope and orders the shadowed rest", () => {
    const resolution = resolveEntries(ref, [
      entry("user"),
      entry("session"),
      entry("workspace"),
    ]);
    expect(resolution?.selected.scope.level).toBe("session");
    expect(resolution?.shadowed.map((shadow) => shadow.scope.level)).toEqual([
      "workspace",
      "user",
    ]);
  });

  it("resolves a single unpinned entry with no shadows", () => {
    const resolution = resolveEntries(ref, [entry("workspace")]);
    expect(resolution?.selected.scope.level).toBe("workspace");
    expect(resolution?.shadowed).toEqual([]);
  });

  it("resolves ordinary unpinned components by precedence without shadow errors", () => {
    const resolution = resolveEntries(ref, [
      entry("organization"),
      entry("user"),
    ]);
    expect(resolution?.selected.scope.level).toBe("user");
    expect(resolution?.shadowed.map((shadow) => shadow.scope.level)).toEqual([
      "organization",
    ]);
  });
});

describe("resolveEntries org-pinning shadow rule", () => {
  it("treats every security-critical kind as pinned and blocks narrower shadows", () => {
    const kinds: readonly ComponentKind[] = [
      "policy",
      "evaluator",
      "gateway",
      "model-provider",
    ];
    for (const kind of kinds) {
      expect(() =>
        resolveEntries(ref, [
          entry("organization", { kind }),
          entry("user", { kind }),
        ])
      ).toThrow(PinnedShadowError);
    }
  });

  it("treats an explicit pinned flag as pinned even for ordinary kinds", () => {
    expect(() =>
      resolveEntries(ref, [
        entry("organization", { pinned: true }),
        entry("user"),
      ])
    ).toThrow(PinnedShadowError);
  });

  it("resolves a pinned component across organization and builtin scopes", () => {
    const resolution = resolveEntries(ref, [
      entry("builtin", { kind: "policy" }),
      entry("organization", { kind: "policy" }),
    ]);
    expect(resolution?.selected.scope.level).toBe("organization");
    expect(resolution?.shadowed.map((shadow) => shadow.scope.level)).toEqual([
      "builtin",
    ]);
  });

  it("blocks a pinned component that has no organization or builtin anchor", () => {
    expect(() => resolveEntries(ref, [entry("user", { kind: "gateway" })]))
      .toThrow(PinnedShadowError);
  });
});
