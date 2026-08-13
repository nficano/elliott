import { coldRunBudgetMinutes } from "./harness";
import type { DoctorLlmProbe, DoctorReport, DoctorSkillOutcome } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const ELAPSED_DECIMALS = 1;

const seconds = (milliseconds: number): string =>
  (milliseconds / MILLISECONDS_PER_SECOND).toFixed(ELAPSED_DECIMALS);

const byStatus = (
  skills: readonly DoctorSkillOutcome[],
  status: DoctorSkillOutcome["status"],
): readonly DoctorSkillOutcome[] =>
  skills.filter((skill) => skill.status === status);

const llmLines = (llm: DoctorLlmProbe): readonly string[] => {
  const head = `LLM probe   ${llm.ok ? "OK" : "FAILED"}  `
    + `(${llm.wire} wire, model ${llm.model}, ${llm.baseUrl})`;
  const detail = llm.ok
    ? `  reply: ${JSON.stringify(llm.reply ?? "")}`
    : `  error: ${llm.error ?? "unknown failure"}`;
  return [head, detail];
};

const skippedReason = (skill: DoctorSkillOutcome): string => {
  if (skill.gate.kind === "secret") {
    return `needs key ${skill.missingKey ?? skill.gateText}`;
  }
  if (skill.gate.kind === "config") {
    return skill.gate.identifier === undefined
      ? "config flag not set"
      : `config ${skill.gate.identifier} not set`;
  }
  return "registered no bindings";
};

const ranLines = (skills: readonly DoctorSkillOutcome[]): readonly string[] => {
  const ran = byStatus(skills, "ran");
  if (ran.length === 0) return ["Ran: (none)"];
  return [
    `Ran (${ran.length}):`,
    ...ran.map((skill) => `  + ${skill.name}`),
  ];
};

const skippedLines = (
  skills: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const skipped = byStatus(skills, "skipped");
  if (skipped.length === 0) return ["Skipped: (none)"];
  return [
    `Skipped (${skipped.length}):`,
    ...skipped.map((skill) => `  - ${skill.name} — ${skippedReason(skill)}`),
  ];
};

// The headline requirement: every skill dormant for want of a vendor key,
// named, with the key it needs and the secret reference to set.
const vendorKeyLines = (
  skills: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const gated = skills.filter(
    (skill) => skill.status === "skipped" && skill.needsVendorKey,
  );
  if (gated.length === 0) {
    return [
      "Vendor keys needed: none — every core skill ran on the LLM keys alone",
    ];
  }
  return [
    `Vendor keys needed (${gated.length}):`,
    ...gated.map((skill) => {
      const refs = skill.secretRefs.length > 0
        ? ` (${skill.secretRefs.join(", ")})`
        : "";
      return `  - ${skill.name}: set ${
        skill.missingKey ?? skill.gateText
      }${refs}`;
    }),
  ];
};

const errorLines = (
  skills: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const errored = byStatus(skills, "error");
  if (errored.length === 0) return [];
  return [
    `Skill errors (${errored.length}):`,
    ...errored.map((skill) => `  ! ${skill.name}: ${skill.error ?? "unknown"}`),
  ];
};

const egressLines = (report: DoctorReport): readonly string[] => {
  const contacted = report.contactedHosts.length > 0
    ? report.contactedHosts.join(", ")
    : "(none)";
  const lines = [`Egress hosts contacted: ${contacted}`];
  if (report.egressViolations.length > 0) {
    lines.push(
      `  ! reached outside the LLM allowlist: ${
        report.egressViolations.join(", ")
      }`,
    );
  }
  return lines;
};

const timingLines = (report: DoctorReport): readonly string[] => {
  const lines = [`Elapsed: ${seconds(report.elapsedMilliseconds)}s`];
  if (report.coldRunBudgetExceeded) {
    lines.push(
      `  ! cold run exceeded the ${coldRunBudgetMinutes}-minute budget`,
    );
  }
  return lines;
};

const warningLines = (report: DoctorReport): readonly string[] =>
  report.warnings.length === 0
    ? []
    : ["Notices:", ...report.warnings.map((line) => `  ~ ${line}`)];

// Render the full report as an operator-facing text block. Ends on an explicit
// PASS/FAIL verdict so the outcome is unambiguous in a terminal.
export const formatReport = (report: DoctorReport): string => {
  const sections: readonly (readonly string[])[] = [
    ["elliott doctor — out-of-box end-to-end check", ""],
    llmLines(report.llm),
    [""],
    ranLines(report.skills),
    [""],
    skippedLines(report.skills),
    [""],
    vendorKeyLines(report.skills),
    [""],
    errorLines(report.skills),
    egressLines(report),
    timingLines(report),
    warningLines(report),
    ["", report.ok ? "VERDICT: PASS" : "VERDICT: FAIL"],
  ];
  return sections
    .filter((section) => section.length > 0)
    .flat()
    .join("\n");
};
