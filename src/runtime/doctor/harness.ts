import path from "node:path";
import type { BundledPackage } from "../../catalog/types";
import { collectPackageViews } from "../skills/loader";
import type { SkillContextSeed, SkillPackageView } from "../skills/types";
import { originOf, withEgressAllowlist } from "./egress";
import { classifyOutcome } from "./gate";
import { readManifestSecretRefs } from "./manifest";
import { invalidEndpointProbe, probeLlm } from "./probe";
import type {
  CapturedReport,
  DoctorDependencies,
  DoctorInput,
  DoctorReport,
  DoctorSkillOutcome,
} from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const COLD_RUN_BUDGET_MINUTES = 5;
const COLD_RUN_BUDGET_MILLISECONDS = COLD_RUN_BUDGET_MINUTES
  * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

export const coldRunBudgetMinutes = COLD_RUN_BUDGET_MINUTES;

const SKILL_MECHANISM_PREFIX = "skill:";

// The endpoint origin, or undefined when the base URL will not parse. Returning
// undefined rather than throwing keeps a bad base_url — an operator config error
// — on the derived-report path instead of an unhandled TypeError that would carry
// the raw URL (which can embed inline credentials) to an outer handler.
const safeOrigin = (baseUrl: string): string | undefined => {
  try {
    return originOf(baseUrl);
  } catch {
    return undefined;
  }
};

// The seed a doctor gives each skill's register(): the full resolved settings,
// a report collector, and inert delivery/sink hooks. Nothing here starts a
// gateway, opens a socket, or attaches an error sink — the harness only wants
// to observe which skills register. The reported ERROR is deliberately dropped:
// a skill's exception text is untrusted and can echo a credential in a form no
// value-matching redaction can catch (a substring, a transform, a non-string),
// so the doctor records only THAT the skill reported (by the loader-stamped
// mechanism) and derives its own failure phrasing. This is addendum 3 applied to
// skill-authored text: derive, never forward.
const doctorSeed = (
  input: DoctorInput,
  reports: CapturedReport[],
): SkillContextSeed => ({
  settings: input.settings,
  stateDirectory: input.settings.stateDirectory,
  packages: () => [],
  report: (_error, mechanism) => {
    reports.push({ mechanism });
  },
  installErrorSink: () => {},
  deliver: async () => {},
});

// Whether a skill's register() reported an error (the loader stamps the mechanism
// `skill:<name>` when register throws). A boolean, not the message — the message
// is never forwarded.
const reportedError = (
  name: string,
  reports: readonly CapturedReport[],
): boolean =>
  reports.some((entry) =>
    entry.mechanism === `${SKILL_MECHANISM_PREFIX}${name}`
  );

// A skill's package is bundled (framework-authored, in this repo, code-reviewed)
// unless it loaded from the consumer's agent-local skills directory
// (agents/<agent>/skills). Only bundled manifests are trusted enough to echo
// their declared secret references into the report; an agent-local manifest is
// untrusted and its references are withheld (see classifyOutcome/format).
const isBundled = (directory: string, agentName: string): boolean =>
  !directory.includes(path.join("agents", agentName, "skills"));

const secretRefsFor = async (
  packages: readonly BundledPackage[],
  read: (directory: string) => Promise<readonly string[]>,
): Promise<ReadonlyMap<string, readonly string[]>> => {
  const entries = await Promise.all(
    packages.map(async (item) =>
      [item.name, await read(item.directory)] as const
    ),
  );
  return new Map(entries);
};

// A classifier bound to one run's reports, manifest references, and agent name,
// so mapping views over it stays a single-argument call.
const classifierFor = (
  reports: readonly CapturedReport[],
  secretRefs: ReadonlyMap<string, readonly string[]>,
  agentName: string,
): (view: SkillPackageView) => DoctorSkillOutcome =>
(view) =>
  classifyOutcome(view, {
    threw: reportedError(view.name, reports),
    secretRefs: secretRefs.get(view.name) ?? [],
    bundled: isBundled(view.directory, agentName),
  });

// A soft report — a skill that reported through the context but still registered
// (its mechanism is not a hard-errored skill's `skill:<name>`). The message is
// untrusted and never forwarded, so notices are reported only as a count: the
// operator learns some skills flagged a non-fatal issue during registration and
// can run a skill directly for detail.
const warningsFrom = (
  reports: readonly CapturedReport[],
  outcomes: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const hardErrors = new Set(
    outcomes
      .filter((outcome) => outcome.status === "error")
      .map((outcome) => `${SKILL_MECHANISM_PREFIX}${outcome.name}`),
  );
  const notices = reports.filter((entry) => !hardErrors.has(entry.mechanism));
  if (notices.length === 0) return [];
  return [
    `${notices.length} skill(s) reported a non-fatal issue during registration`,
  ];
};

// Boot the framework skills under an LLM-only egress guard, classify what
// registered, then run one live model round-trip. Never throws for an expected
// failure (a bad key, a dormant skill, an egress breach) — those land in the
// returned report with `ok: false`. The only throw path is a genuinely
// unexpected fault in the harness itself.
export const runDoctor = async (
  input: DoctorInput,
  deps: DoctorDependencies,
): Promise<DoctorReport> => {
  const start = deps.now();
  const reports: CapturedReport[] = [];
  const seed = doctorSeed(input, reports);
  const allowedOrigin = safeOrigin(input.settings.llmBaseUrl);
  if (allowedOrigin === undefined) {
    // No origin to pin egress to and no endpoint to reach: report a derived
    // failure (the URL is never echoed) rather than throwing past the harness.
    const elapsedMilliseconds = deps.now() - start;
    return {
      ok: false,
      elapsedMilliseconds,
      coldRunBudgetExceeded: elapsedMilliseconds > COLD_RUN_BUDGET_MILLISECONDS,
      skills: [],
      llm: invalidEndpointProbe(input.settings, input.secretValues),
      contactedHosts: [],
      egressViolations: [],
      warnings: [],
    };
  }
  const trace = await withEgressAllowlist([allowedOrigin], async () => {
    const packages = await deps.loadPackages(input.roots);
    const skills = await deps.register(packages, seed);
    const secretRefs = await secretRefsFor(packages, deps.manifestSecrets);
    const views = collectPackageViews(packages, skills);
    const outcomes = views.map(
      classifierFor(reports, secretRefs, input.roots.agentName),
    );
    // The probe reports only facts it derives (endpoint origin, model id, a
    // fixed outcome phrase), never anything the endpoint controls. It still runs
    // its metadata through the recorded secret set so a credential that happens
    // to equal a resolved config value is scrubbed.
    const llm = await probeLlm(
      input.settings,
      deps.makeCompleter,
      input.secretValues,
    );
    return { outcomes, llm };
  });
  const { outcomes, llm } = trace.result;
  const elapsedMilliseconds = deps.now() - start;
  const hasSkillError = outcomes.some((outcome) => outcome.status === "error");
  return {
    ok: llm.ok && trace.violations.length === 0 && !hasSkillError,
    elapsedMilliseconds,
    coldRunBudgetExceeded: elapsedMilliseconds > COLD_RUN_BUDGET_MILLISECONDS,
    skills: outcomes,
    llm,
    contactedHosts: trace.contactedHosts,
    egressViolations: trace.violations,
    warnings: warningsFrom(reports, outcomes),
  };
};

// The real dependency set: the framework's own bundled-package loader, skill
// registrar, model client, manifest reader, and a monotonic clock.
export const defaultDoctorDependencies = (
  loadPackages: DoctorDependencies["loadPackages"],
  register: DoctorDependencies["register"],
  makeCompleter: DoctorDependencies["makeCompleter"],
): DoctorDependencies => ({
  loadPackages,
  register,
  makeCompleter,
  manifestSecrets: readManifestSecretRefs,
  now: () => performance.now(),
});
