import { describe, expect, it } from "bun:test";
import { formatReport } from "../../src/runtime/doctor/format";
import type {
  DoctorReport,
  DoctorSkillOutcome,
} from "../../src/runtime/doctor/types";

const noBindings = {
  tools: 0,
  gateways: 0,
  routes: 0,
  services: 0,
  facilities: 0,
} as const;

const ranSkill: DoctorSkillOutcome = {
  name: "fetch",
  kind: "tool",
  status: "ran",
  gate: { kind: "always" },
  gateText: "always",
  secretRefs: [],
  needsVendorKey: false,
  bindings: { ...noBindings, tools: 1 },
};

const skippedSkill: DoctorSkillOutcome = {
  name: "search-brave",
  kind: "tool",
  status: "skipped",
  gate: { kind: "secret", identifier: "braveApiKey" },
  gateText: "secret:braveApiKey",
  secretRefs: ["secret://search/brave/api-key"],
  needsVendorKey: true,
  bindings: noBindings,
};

const baseReport = (
  overrides: Partial<DoctorReport>,
): DoctorReport => ({
  ok: true,
  elapsedMilliseconds: 1500,
  coldRunBudgetExceeded: false,
  skills: [ranSkill, skippedSkill],
  llm: {
    ok: true,
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
  },
  contactedHosts: ["api.anthropic.com"],
  egressViolations: [],
  warnings: [],
  ...overrides,
});

describe("formatReport", () => {
  it("renders a passing report with ran, skipped, and vendor-key sections", () => {
    const text = formatReport(baseReport({}));
    expect(text).toContain("LLM probe   OK");
    expect(text).toContain("completion received");
    expect(text).toContain("+ fetch");
    expect(text).toContain(
      "- search-brave — dormant (gate secret:braveApiKey)",
    );
    expect(text).toContain(
      "search-brave: supply secret://search/brave/api-key  (gate secret:braveApiKey)",
    );
    expect(text).toContain("Egress hosts contacted: api.anthropic.com");
    expect(text).toContain("Elapsed: 1.5s");
    expect(text.trimEnd().endsWith("VERDICT: PASS")).toBe(true);
  });

  it("names the LLM failure classification and ends on FAIL", () => {
    const text = formatReport(
      baseReport({
        ok: false,
        llm: {
          ok: false,
          wire: "anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-haiku-4-5-20251001",
          error: "authentication rejected (HTTP 401)",
        },
      }),
    );
    expect(text).toContain("LLM probe   FAILED");
    expect(text).toContain("error: authentication rejected (HTTP 401)");
    expect(text.trimEnd().endsWith("VERDICT: FAIL")).toBe(true);
  });

  it("shows an egress violation line", () => {
    const text = formatReport(
      baseReport({
        ok: false,
        egressViolations: ["evil.example.com"],
        contactedHosts: ["api.anthropic.com", "evil.example.com"],
      }),
    );
    expect(text).toContain(
      "reached outside the LLM allowlist: evil.example.com",
    );
  });

  it("warns when the cold-run budget is exceeded", () => {
    const text = formatReport(baseReport({ coldRunBudgetExceeded: true }));
    expect(text).toContain("cold run exceeded the 5-minute budget");
  });

  it("lists skill errors and notices", () => {
    const text = formatReport(
      baseReport({
        ok: false,
        skills: [{
          name: "broken",
          kind: "tool",
          status: "error",
          gate: { kind: "always" },
          gateText: "always",
          secretRefs: [],
          needsVendorKey: false,
          bindings: noBindings,
          error: "register exploded",
        }],
        warnings: ["glitchtip:config: DSN could not be parsed"],
      }),
    );
    expect(text).toContain("! broken: register exploded");
    expect(text).toContain("~ glitchtip:config: DSN could not be parsed");
  });

  it("states when no vendor keys are needed", () => {
    const text = formatReport(baseReport({ skills: [ranSkill] }));
    expect(text).toContain("Vendor keys needed: none");
  });
});
