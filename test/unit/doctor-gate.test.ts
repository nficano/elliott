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

const bundled = (
  threw: boolean,
  secretRefs: readonly string[] = [],
): {
  readonly threw: boolean;
  readonly secretRefs: readonly string[];
  readonly bundled: boolean;
} => ({
  threw,
  secretRefs,
  bundled: true,
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
      bundled(false),
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
      bundled(false, ["secret://search/brave/api-key"]),
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.needsVendorKey).toBe(true);
    expect(outcome.gate).toEqual({ kind: "secret", identifier: "braveApiKey" });
    expect(outcome.secretRefs).toEqual(["secret://search/brave/api-key"]);
  });

  it("marks a config-gated skill that declares a secret ref as needing a vendor key", () => {
    // gateway-slack is gated on channels.slack.enabled yet also requires
    // secret://gateways/slack — a config gate does not exempt it from the
    // vendor-key list.
    const outcome = classifyOutcome(
      view({ topology: { gate: "config:channels.slack.enabled" } }),
      bundled(false, ["secret://gateways/slack"]),
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.needsVendorKey).toBe(true);
    expect(outcome.secretRefs).toEqual(["secret://gateways/slack"]);
  });

  it("marks a config-gated skill with no secret as skipped without a vendor key", () => {
    const outcome = classifyOutcome(
      view({ topology: { gate: "config:tools.terminal.enabled" } }),
      bundled(false),
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.needsVendorKey).toBe(false);
  });

  it("withholds an agent-local manifest's secret references from the report", () => {
    // An untrusted agent-local manifest could smuggle a credential behind a
    // secret:// prefix; its references are dropped, so they never print.
    const outcome = classifyOutcome(
      view({ topology: { gate: "secret:x" } }),
      {
        threw: false,
        secretRefs: ["secret://sk-live-smuggled"],
        bundled: false,
      },
    );
    expect(outcome.needsVendorKey).toBe(true);
    expect(outcome.secretRefs).toEqual([]);
  });

  it("marks an unregistered skill that threw as an error, with a derived message", () => {
    const outcome = classifyOutcome(view({ registered: false }), bundled(true));
    expect(outcome.status).toBe("error");
    // The skill's exception text is never forwarded; the message is derived.
    expect(outcome.error).toBe("register() failed during startup");
    expect(outcome.needsVendorKey).toBe(false);
  });

  it("marks an unregistered skill with no report as error, not skipped", () => {
    // A package that produced no registration never loaded — a real gap, not an
    // expected gate miss (a gate miss still registers and returns no bindings).
    const outcome = classifyOutcome(
      view({ registered: false }),
      bundled(false),
    );
    expect(outcome.status).toBe("error");
    expect(outcome.error).toContain("did not load");
  });
});
