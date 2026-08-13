import { describe, expect, it } from "bun:test";
import {
  classifyOutcome,
  gateTextOf,
  parseGate,
} from "../../src/runtime/doctor/gate";
import type { SkillPackageView } from "../../src/runtime/skills/types";

const view = (
  overrides: Partial<SkillPackageView>,
): SkillPackageView => ({
  name: "example",
  kind: "tool",
  directory: "/skills/example",
  provides: [],
  registered: true,
  bindings: { tools: 0, gateways: 0, routes: 0, services: 0, facilities: 0 },
  ...overrides,
});

describe("parseGate", () => {
  it("treats always and empty as ungated", () => {
    expect(parseGate("always")).toEqual({ kind: "always" });
    expect(parseGate("")).toEqual({ kind: "always" });
  });

  it("splits secret and config gates on the first colon", () => {
    expect(parseGate("secret:braveApiKey")).toEqual({
      kind: "secret",
      identifier: "braveApiKey",
    });
    expect(parseGate("config:tools.files.enabled")).toEqual({
      kind: "config",
      identifier: "tools.files.enabled",
    });
  });

  it("keeps a bare config gate without an identifier", () => {
    expect(parseGate("config")).toEqual({ kind: "config" });
  });

  it("surfaces an unknown grammar as a config gate rather than always", () => {
    expect(parseGate("flag=on")).toEqual({
      kind: "config",
      identifier: "flag=on",
    });
  });
});

describe("gateTextOf", () => {
  it("reads the gate string from the topology block", () => {
    expect(gateTextOf(view({ topology: { gate: "secret:x" } }))).toBe(
      "secret:x",
    );
  });

  it("falls back to always for a missing or non-string gate", () => {
    expect(gateTextOf(view({}))).toBe("always");
    expect(gateTextOf(view({ topology: { gate: 5 } }))).toBe("always");
  });
});

describe("classifyOutcome", () => {
  it("marks a skill with bindings as ran", () => {
    const outcome = classifyOutcome(
      view({
        topology: { gate: "always" },
        bindings: {
          tools: 1,
          gateways: 0,
          routes: 0,
          services: 0,
          facilities: 0,
        },
      }),
      undefined,
      [],
    );
    expect(outcome.status).toBe("ran");
    expect(outcome.needsVendorKey).toBe(false);
  });

  it("marks a secret-gated skill with no bindings as skipped needing a vendor key", () => {
    const outcome = classifyOutcome(
      view({
        name: "search-brave",
        topology: { gate: "secret:braveApiKey" },
      }),
      undefined,
      ["secret://search/brave/api-key"],
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.needsVendorKey).toBe(true);
    expect(outcome.gate).toEqual({ kind: "secret", identifier: "braveApiKey" });
    expect(outcome.secretRefs).toEqual(["secret://search/brave/api-key"]);
  });

  it("marks a config-gated skill with no bindings as skipped without a vendor key", () => {
    const outcome = classifyOutcome(
      view({ topology: { gate: "config:tools.terminal.enabled" } }),
      undefined,
      [],
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.needsVendorKey).toBe(false);
  });

  it("marks an unregistered skill with a captured error as error", () => {
    const outcome = classifyOutcome(
      view({ registered: false }),
      "boom during register",
      [],
    );
    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("boom during register");
    expect(outcome.needsVendorKey).toBe(false);
  });

  it("marks an unregistered skill with no captured error as error, not skipped", () => {
    // A package that produced no registration never loaded — a real gap, not an
    // expected gate miss (a gate miss still registers and returns no bindings).
    const outcome = classifyOutcome(view({ registered: false }), undefined, []);
    expect(outcome.status).toBe("error");
    expect(outcome.error).toContain("did not load");
  });
});
