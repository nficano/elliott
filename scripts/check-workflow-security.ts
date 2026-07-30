#!/usr/bin/env bun
/**
 * GitHub Actions hardening gate ("pwn request" defense). Flags workflow
 * shapes that hand untrusted PR code a privileged context:
 *
 *  1. A `pull_request_target` / `workflow_run` workflow that checks out the
 *     PR head — those triggers run with secrets and a write token, so
 *     executing attacker-controlled code there is repo takeover.
 *  2. A pull-request-triggered job on a self-hosted runner — fork PRs would
 *     execute arbitrary code on our own hardware.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const WORKFLOWS_DIR = ".github/workflows";
const PRIVILEGED_TRIGGERS = new Set(["pull_request_target", "workflow_run"]);
const PR_TRIGGERS = new Set(["pull_request", "pull_request_target"]);
const UNTRUSTED_REF_MARKERS = [
  "github.event.pull_request.head",
  "github.head_ref",
  "github.event.workflow_run",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
};

const triggersOf = (document: unknown): readonly string[] => {
  if (!isRecord(document)) return [];
  const on = document.on;
  if (isRecord(on)) return Object.keys(on);
  return asStrings(on);
};

const untrustedCheckouts = (
  job: Record<string, unknown>,
): readonly string[] => {
  if (!Array.isArray(job.steps)) return [];
  const refs: string[] = [];
  for (const step of job.steps) {
    if (!isRecord(step)) continue;
    const uses = typeof step.uses === "string" ? step.uses : "";
    const ref = isRecord(step.with) && typeof step.with.ref === "string"
      ? step.with.ref
      : "";
    const untrusted = UNTRUSTED_REF_MARKERS.some((marker) =>
      ref.includes(marker)
    );
    if (uses.startsWith("actions/checkout") && untrusted) refs.push(ref);
  }
  return refs;
};

const jobFindings = (input: {
  readonly file: string;
  readonly name: string;
  readonly job: Record<string, unknown>;
  readonly triggers: readonly string[];
}): readonly string[] => {
  const { file, job, name, triggers } = input;
  const findings: string[] = [];
  const privileged = triggers.filter((item) => PRIVILEGED_TRIGGERS.has(item));
  if (privileged.length > 0) {
    for (const ref of untrustedCheckouts(job)) {
      findings.push(
        `${file}: job "${name}" checks out untrusted ref "${ref}" under `
          + `privileged trigger(s) ${privileged.join(", ")}`,
      );
    }
  }
  const selfHosted = asStrings(job["runs-on"]).some((runner) =>
    runner.includes("self-hosted")
  );
  if (selfHosted && triggers.some((item) => PR_TRIGGERS.has(item))) {
    findings.push(
      `${file}: job "${name}" runs pull-request-triggered work on a `
        + "self-hosted runner (fork PRs would execute code on our hardware)",
    );
  }
  return findings;
};

const fileFindings = async (file: string): Promise<readonly string[]> => {
  const document: unknown = parse(await Bun.file(file).text());
  if (!isRecord(document) || !isRecord(document.jobs)) return [];
  const triggers = triggersOf(document);
  return Object.entries(document.jobs).flatMap(([name, job]) =>
    isRecord(job) ? jobFindings({ file, name, job, triggers }) : []
  );
};

if (!existsSync(WORKFLOWS_DIR)) {
  console.log("✓ workflow gate: no workflows directory.");
  process.exit(0);
}
const files = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => path.join(WORKFLOWS_DIR, name));

const allFindings: string[] = [];
for (const file of files) {
  allFindings.push(...await fileFindings(file));
}

if (allFindings.length === 0) {
  console.log(
    `✓ workflow gate: ${files.length} workflow(s) clear of pwn-request shapes.`,
  );
  process.exit(0);
}
console.error("✗ workflow gate: dangerous GitHub Actions patterns found:");
for (const finding of allFindings) console.error(`  ${finding}`);
process.exit(1);
