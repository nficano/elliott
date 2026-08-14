import { describe, expect, it } from "bun:test";
import type { BundledPackage } from "../../src/catalog/types";
import { runDoctor } from "../../src/runtime/doctor/harness";
import type {
  DoctorDependencies,
  DoctorInput,
} from "../../src/runtime/doctor/types";
import type {
  LoadedSkill,
  SkillContextSeed,
  SkillRegistration,
} from "../../src/runtime/skills/types";
import type { RuntimeSettings } from "../../src/runtime/types";

const MINUTE_MS = 60_000;

const input: DoctorInput = {
  roots: {
    frameworkRoot: "/repo",
    agentRoot: "/repo",
    agentName: "elliott",
  },
  settings: {
    llmWire: "anthropic",
    llmBaseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
    stateDirectory: "/repo/.elliott-runtime",
  } as unknown as RuntimeSettings,
  secretValues: [],
};

const pkg = (name: string, gate: string): BundledPackage => ({
  name,
  kind: "tool",
  profile: "tool-standard",
  directory: `/repo/skills/${name}`,
  document: "SKILL.md",
  protocols: [],
  provides: [],
  exports: [],
  topology: { gate },
});

const loaded = (
  name: string,
  registration: SkillRegistration,
): LoadedSkill => ({
  name,
  registration,
});

const okCompleter: DoctorDependencies["makeCompleter"] = () => ({
  complete: async () => ({ text: "ready", toolCalls: [] }),
});

// A clock that returns each supplied timestamp in order, so elapsed time is
// deterministic without touching the wall clock.
const clock = (...values: readonly number[]): () => number => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
};

const deps = (
  overrides: Partial<DoctorDependencies>,
): DoctorDependencies => ({
  loadPackages: async () => [],
  register: async () => [],
  makeCompleter: okCompleter,
  manifestSecrets: async () => [],
  now: clock(0, 1),
  ...overrides,
});

describe("runDoctor", () => {
  it("returns a derived failure for an unparseable base URL instead of throwing", async () => {
    // originOf would throw a TypeError carrying the raw URL (which can embed a
    // credential). The harness must instead report a failed probe — no skills
    // registered, no egress attempted — and never let the URL escape.
    const badInput: DoctorInput = {
      ...input,
      settings: { ...input.settings, llmBaseUrl: "not-a-url-sk-leak" },
      secretValues: ["sk-leak"],
    };
    let threw = false;
    const report = await runDoctor(badInput, deps({})).catch(
      (error: unknown) => {
        threw = true;
        throw error;
      },
    );
    expect(threw).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.llm.ok).toBe(false);
    expect(report.llm.error).toBe("endpoint is not a valid URL");
    expect(report.skills).toEqual([]);
    expect(report.contactedHosts).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("sk-leak");
  });

  it("never forwards a skill's exception text, even a transformed or non-string config value", async () => {
    // The skill echoes a SLICE of one config value and a non-string one; neither
    // could be caught by value-matching redaction. The doctor forwards no skill
    // message at all — the error is a phrase it derives — so the class of leak
    // (transform, substring, non-string) is closed by construction.
    const withSkillConfig: DoctorInput = {
      ...input,
      settings: {
        ...input.settings,
        skillConfig: { local: { auth: "sk-auth-literal", pin: 123_456 } },
      },
      secretValues: [],
    };
    const report = await runDoctor(
      withSkillConfig,
      deps({
        loadPackages: async () => [pkg("weird", "always")],
        register: async (_packages, seed) => {
          const local = (seed.settings.skillConfig as {
            local: { auth: string; pin: number; };
          }).local;
          seed.report(
            new Error(`${local.auth.slice(3)} pin=${local.pin}`),
            "skill:weird",
          );
          return [];
        },
      }),
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain("auth-literal");
    expect(text).not.toContain("123456");
    expect(report.skills.find((s) => s.name === "weird")?.error).toBe(
      "register() failed during startup",
    );
  });

  it("classifies ran and skipped skills and passes when the probe succeeds", async () => {
    const packages = [
      pkg("fetch", "always"),
      pkg("search-brave", "secret:braveApiKey"),
    ];
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => packages,
        register: async () => [
          loaded("fetch", {
            tools: [{
              name: "fetch",
              description: "",
              inputSchema: {},
              execute: async () => "",
            }],
          }),
          loaded("search-brave", {}),
        ],
        manifestSecrets: async (directory) =>
          directory.endsWith("search-brave")
            ? ["secret://search/brave/api-key"]
            : [],
      }),
    );
    expect(report.ok).toBe(true);
    const brave = report.skills.find((s) => s.name === "search-brave");
    const fetchSkill = report.skills.find((s) => s.name === "fetch");
    expect(fetchSkill?.status).toBe("ran");
    expect(brave?.status).toBe("skipped");
    expect(brave?.needsVendorKey).toBe(true);
    expect(brave?.gate).toEqual({ kind: "secret", identifier: "braveApiKey" });
    expect(brave?.secretRefs).toEqual(["secret://search/brave/api-key"]);
    expect(report.egressViolations).toEqual([]);
  });

  it("fails when a package produced no registration (no entrypoint)", async () => {
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => [pkg("broken", "always")],
        register: async () => [],
      }),
    );
    const broken = report.skills.find((s) => s.name === "broken");
    expect(broken?.status).toBe("error");
    expect(broken?.error).toContain("did not load");
    expect(report.ok).toBe(false);
  });

  it("fails when the LLM probe fails", async () => {
    const report = await runDoctor(
      input,
      deps({
        makeCompleter: () => ({
          complete: async () => {
            throw Object.assign(new Error("openai 401: body"), { status: 401 });
          },
        }),
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.llm.ok).toBe(false);
    expect(report.llm.error).toBe("authentication rejected (HTTP 401)");
  });

  it("fails and records a violation when a probe reaches a non-LLM host", async () => {
    const report = await runDoctor(
      input,
      deps({
        makeCompleter: () => ({
          complete: async () => {
            await fetch("https://telemetry.example.com/beacon");
            return { text: "ready", toolCalls: [] };
          },
        }),
      }),
    );
    expect(report.ok).toBe(false);
    // The off-box hop is recorded as an egress violation; the probe reports a
    // generic classification rather than echoing the blocked-host error text.
    expect(report.egressViolations).toEqual(["telemetry.example.com"]);
    expect(report.llm.ok).toBe(false);
    expect(report.llm.error).toBe("endpoint unreachable or did not respond");
  });

  it("treats a thrown register as a skill error that fails the run", async () => {
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => [pkg("broken", "always")],
        register: async (_packages, seed: SkillContextSeed) => {
          seed.report(new Error("register exploded"), "skill:broken");
          return [];
        },
      }),
    );
    const broken = report.skills.find((s) => s.name === "broken");
    expect(broken?.status).toBe("error");
    // The exception text ("register exploded") is never forwarded; derived phrase.
    expect(broken?.error).toBe("register() failed during startup");
    expect(report.ok).toBe(false);
  });

  it("carries no skill-authored text in the error, whatever the skill threw", async () => {
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => [pkg("broken", "always")],
        register: async (_packages, seed: SkillContextSeed) => {
          seed.report(
            new Error("setup rejected sk-secret-xyz"),
            "skill:broken",
          );
          return [];
        },
      }),
    );
    const broken = report.skills.find((s) => s.name === "broken");
    expect(broken?.error).toBe("register() failed during startup");
    expect(JSON.stringify(report)).not.toContain("sk-secret-xyz");
  });

  it("surfaces a soft register report as a count-only non-fatal notice", async () => {
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => [pkg("glitchtip", "config:x.enabled")],
        register: async (_packages, seed: SkillContextSeed) => {
          // The message would carry skill-authored text, so only the count is
          // surfaced — never "DSN could not be parsed" verbatim.
          seed.report(new Error("DSN could not be parsed"), "glitchtip:config");
          return [loaded("glitchtip", {})];
        },
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain(
      "1 skill(s) reported a non-fatal issue during registration",
    );
  });

  it("flags a cold run over the five-minute budget without failing it", async () => {
    const report = await runDoctor(
      input,
      deps({ now: clock(0, 6 * MINUTE_MS) }),
    );
    expect(report.coldRunBudgetExceeded).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.elapsedMilliseconds).toBe(6 * MINUTE_MS);
  });

  it("stays within budget for a fast run", async () => {
    const report = await runDoctor(input, deps({ now: clock(0, 1200) }));
    expect(report.coldRunBudgetExceeded).toBe(false);
  });

  // `metadata.name` is manifest-authored, so an agent-local package can claim a
  // bundled package's name. Manifest references keyed by NAME let that collision
  // overwrite the bundled entry, and the bundled row — the one the report treats
  // as trusted and therefore prints — would carry the agent-local text. Keying by
  // directory makes the two packages distinct however they name themselves.
  it("does not let an agent-local package overwrite a bundled package's secret refs", async () => {
    const bundledPkg = pkg("search-brave", "secret:braveApiKey");
    const impostor: BundledPackage = {
      ...bundledPkg,
      directory: "/repo/agents/elliott/skills/search-brave",
    };
    const report = await runDoctor(
      input,
      deps({
        loadPackages: async () => [bundledPkg, impostor],
        register: async () => [],
        manifestSecrets: async (directory: string) =>
          directory === impostor.directory
            ? ["secret://sk-live-collision"]
            : ["secret://search/brave/api-key"],
      }),
    );
    const trusted = report.skills.find((row) =>
      row.name === "search-brave" && row.secretRefs.length > 0
    );
    expect(trusted?.secretRefs).toEqual(["secret://search/brave/api-key"]);
    expect(JSON.stringify(report)).not.toContain("sk-live-collision");
  });
});
