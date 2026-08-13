import type { BundledPackage } from "../../catalog/types";
import { collectPackageViews } from "../skills/loader";
import type { SkillContextSeed, SkillPackageView } from "../skills/types";
import { hostOf, withEgressAllowlist } from "./egress";
import { classifyOutcome } from "./gate";
import { readManifestSecretRefs } from "./manifest";
import { cleanMessage, sanitizeForDisplay } from "./message";
import { probeLlm } from "./probe";
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

// The seed a doctor gives each skill's register(): the full resolved settings,
// a report collector, and inert delivery/sink hooks. Nothing here starts a
// gateway, opens a socket, or attaches an error sink — the harness only wants
// to observe which skills register.
const doctorSeed = (
  input: DoctorInput,
  reports: CapturedReport[],
): SkillContextSeed => ({
  settings: input.settings,
  stateDirectory: input.settings.stateDirectory,
  packages: () => [],
  report: (error, mechanism) => {
    // A captured message is operator-facing: scrub the key and flatten it so a
    // skill (or anything it wraps) cannot leak a secret or forge report lines.
    reports.push({
      mechanism,
      message: sanitizeForDisplay(cleanMessage(error), [
        input.settings.llmApiKey,
      ]),
    });
  },
  installErrorSink: () => {},
  deliver: async () => {},
});

const errorFor = (
  name: string,
  reports: readonly CapturedReport[],
): string | undefined =>
  reports.find((entry) =>
    entry.mechanism === `${SKILL_MECHANISM_PREFIX}${name}`
  )
    ?.message;

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

const classifyAll = (
  views: readonly SkillPackageView[],
  reports: readonly CapturedReport[],
  secretRefs: ReadonlyMap<string, readonly string[]>,
): readonly DoctorSkillOutcome[] =>
  views.map((view) =>
    classifyOutcome(
      view,
      errorFor(view.name, reports),
      secretRefs.get(view.name) ?? [],
    )
  );

// Reports that did not become a skill's hard error (register threw). A skill
// that soft-reports through the context but still returns bindings — or returns
// {} without throwing, like a default-on glitchtip with no collector — is a
// notice, not a failure.
const warningsFrom = (
  reports: readonly CapturedReport[],
  outcomes: readonly DoctorSkillOutcome[],
): readonly string[] => {
  const hardErrors = new Set(
    outcomes
      .filter((outcome) => outcome.status === "error")
      .map((outcome) => `${SKILL_MECHANISM_PREFIX}${outcome.name}`),
  );
  return reports
    .filter((entry) => !hardErrors.has(entry.mechanism))
    .map((entry) => `${entry.mechanism}: ${entry.message}`);
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
  const allowedHost = hostOf(input.settings.llmBaseUrl);
  const trace = await withEgressAllowlist([allowedHost], async () => {
    const packages = await deps.loadPackages(input.frameworkRoot);
    const skills = await deps.register(packages, seed);
    const secretRefs = await secretRefsFor(packages, deps.manifestSecrets);
    const views = collectPackageViews(packages, skills);
    const outcomes = classifyAll(views, reports, secretRefs);
    const llm = await probeLlm(input.settings, deps.makeCompleter);
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
