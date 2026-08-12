import { describe, expect, it } from "bun:test";
import { findGrantedCapability } from "../../src/security/broker/broker";
import type { Capability, GrantSet } from "../../src/security/grants/types";

const grantSet = (capabilities: readonly Capability[]): GrantSet => ({
  capabilities,
  limits: {},
});

const READ: Capability = {
  capability: "fs.read",
  resources: ["fs:/data/exact", "fs:/logs/**"],
};

describe("findGrantedCapability", () => {
  it("returns a capability matched on an exact resource", () => {
    expect(
      findGrantedCapability(grantSet([READ]), "fs.read", "fs:/data/exact"),
    ).toBe(READ);
  });

  it("returns a capability matched on a wildcard resource", () => {
    expect(
      findGrantedCapability(grantSet([READ]), "fs.read", "fs:/logs/today"),
    ).toBe(READ);
  });

  it("returns undefined when the capability name matches but the resource does not", () => {
    expect(
      findGrantedCapability(grantSet([READ]), "fs.read", "fs:/secret/x"),
    ).toBeUndefined();
  });

  it("returns undefined when no capability name matches", () => {
    expect(
      findGrantedCapability(grantSet([READ]), "fs.write", "fs:/data/exact"),
    ).toBeUndefined();
  });

  it("returns undefined for an empty grant set", () => {
    expect(
      findGrantedCapability(grantSet([]), "fs.read", "fs:/data/exact"),
    ).toBeUndefined();
  });

  it("selects the capability whose name and resource both match", () => {
    const write: Capability = {
      capability: "fs.write",
      resources: ["fs:/data/**"],
    };
    expect(
      findGrantedCapability(
        grantSet([READ, write]),
        "fs.write",
        "fs:/data/new",
      ),
    ).toBe(write);
  });
});
