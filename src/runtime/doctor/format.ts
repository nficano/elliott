import { coldRunBudgetMinutes } from "./harness";
import { oneLine } from "./message";
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
    + `(${llm.wire} wire, model ${oneLine(llm.model)}, ${
      oneLine(llm.baseUrl)
    })`;
  // Both reply and error are already sanitized at the probe boundary; oneLine
  // here is the renderer's own guarantee that no dynamic value it interpolates
  // can span lines, independent of who produced it.
  const detail = llm.ok
    ? `  reply: ${JSON.stringify(oneLine(llm.reply ?? ""))}`
    : `  error: ${oneLine(llm.error ?? "unknown failure")}`;
  return [head, detail];
};

const skippedReason = (skill: DoctorSkillOutcome): string => {
  if (skill.gate.kind === "secret") {
    return `dormant (gate ${skill.gateText})`;
  }
  if (skill.gate.kind === "config") {
    return skill.gate.identifier === undefined
      ? "dormant (config flag not set)"
      : `dormant (config ${skill.gate.identifier} not set)`;
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
// named, with the secret(s) to supply and its manifest gate. The secret
// references are authoritative; some skills need extra config beyond them (a
// composite gate such as SMTP), so the section points at the activation-gates
// reference rather than presenting the gate as a single key to set.
const ACTIVATION_GATES_REF =
  "see docs/reference/activation-gates.md for the full requirement of each";

const vendorKeyDetail = (skill: DoctorSkillOutcome): string => {
  const secrets = skill.secretRefs.length > 0
    ? skill.secretRefs.join(", ")
    : skill.gate.identifier ?? skill.gateText;
  return `  - ${skill.name}: supply ${secrets}  (gate ${skill.gateText})`;
};

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
    `Vendor keys needed (${gated.length}) — ${ACTIVATION_GATES_REF}:`,
    ...gated.map(vendorKeyDetail),
  ];
};

const errorLines = (
  skills: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const errored = byStatus(skills, "error");
  if (errored.length === 0) return [];
  return [
    `Skill errors (${errored.length}):`,
    ...errored.map((skill) =>
      `  ! ${oneLine(skill.name)}: ${oneLine(skill.error ?? "unknown")}`
    ),
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
    : ["Notices:", ...report.warnings.map((line) => `  ~ ${oneLine(line)}`)];

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
