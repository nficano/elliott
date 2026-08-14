import {
  loadAgentSkillPackages,
  loadBundledPackages,
} from "../../catalog/bundled";
import type { BundledPackage } from "../../catalog/types";
import {
  envBackedSecretResolver,
  loadRuntimeSettings,
  runtimeEnvironment,
} from "../config";
import { RuntimeModelClient } from "../model/client";
import { loadSkillRegistrations } from "../skills/loader";
import type { RuntimeSettings, SecretResolver } from "../types";
import { formatReport } from "./format";
import { defaultDoctorDependencies, runDoctor } from "./harness";
import {
  cleanMessage,
  dropCodeFrame,
  oneLine,
  redactSecrets,
  stripUrlUserinfo,
} from "./message";
import type { DoctorEnv, DoctorEnvOverlay, DoctorRoots } from "./types";

const DOCTOR_COMMAND = "doctor";
const DEFAULT_AGENT_NAME = "elliott";
// A consumer repo whose agent is not named "elliott" points the doctor at it
// with this — the same name its own runtime boots under.
const AGENT_NAME_VAR = "ELLIOTT_AGENT_NAME";

// Cheap, current first-party models used when the operator supplies only a
// vendor key and no explicit ELLIOTT_LLM_MODEL. Deliberately the smallest tier
// of each provider — the probe only needs a well-formed completion, not a
// capable one. Override with ELLIOTT_LLM_MODEL for any other model.
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const LLM_PROVIDER_VAR = "ELLIOTT_LLM_PROVIDER";
const LLM_API_KEY_VAR = "ELLIOTT_LLM_API_KEY";
const LLM_MODEL_VAR = "ELLIOTT_LLM_MODEL";
const ANTHROPIC_KEY_VAR = "ANTHROPIC_API_KEY";
const OPENAI_KEY_VAR = "OPENAI_API_KEY";

// A present, non-BLANK value, else undefined. An empty or whitespace-only
// environment variable (`ANTHROPIC_API_KEY=` or `=" "`) is an ABSENT credential,
// not a supplied one: a blank key would otherwise build a full overlay and send
// the run down the probe/authentication-failure path instead of the missing-key
// path with its guidance. Tested on the trimmed value; the original is returned
// so a real key is never silently altered.
const present = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined;

const inferProvider = (env: DoctorEnv): string | undefined => {
  if (present(env[ANTHROPIC_KEY_VAR]) !== undefined) return "anthropic";
  if (present(env[OPENAI_KEY_VAR]) !== undefined) return "openai";
  return undefined;
};

const vendorKeyFor = (provider: string, env: DoctorEnv): string | undefined => {
  if (provider === "anthropic") return present(env[ANTHROPIC_KEY_VAR]);
  if (provider === "openai") return present(env[OPENAI_KEY_VAR]);
  return undefined;
};

const defaultModelFor = (provider: string): string | undefined => {
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_MODEL;
  if (provider === "openai") return DEFAULT_OPENAI_MODEL;
  return undefined;
};

// The message above this hint already names the exact variable the loaded
// config is missing. The hint offers the two ways to supply it. It does NOT
// list base_url as an env-only alternative: the shipped config reads a
// provider (its base_url line is commented), so a base_url setup means editing
// config/elliott.yaml, not exporting a variable — claiming otherwise would
// contradict the missing-variable message.
const MISSING_CONFIG_HINT =
  "elliott doctor needs LLM credentials for the config it loaded. Set either:\n"
  + `  - ${ANTHROPIC_KEY_VAR} (Anthropic) or ${OPENAI_KEY_VAR} (OpenAI) for a `
  + "turnkey run, or\n"
  + `  - the ${LLM_PROVIDER_VAR} / ${LLM_API_KEY_VAR} / ${LLM_MODEL_VAR} `
  + "variables the shipped config reads.";

// Build the environment overlay the doctor applies before loading settings.
// The convenience path fills the whole LLM trio from a lone vendor key so a
// fresh clone works with just ANTHROPIC_API_KEY or OPENAI_API_KEY. When the
// trio cannot be derived (no vendor key and no explicit provider), the overlay
// is empty: the operator may already export ELLIOTT_LLM_* or a base_url, and
// the config boundary validates and names any gap itself.
export const doctorEnvOverlay = (env: DoctorEnv): DoctorEnvOverlay => {
  const empty: DoctorEnvOverlay = { overlay: {}, modelDefaulted: false };
  const provider = present(env[LLM_PROVIDER_VAR]) ?? inferProvider(env);
  if (provider === undefined) return empty;
  const apiKey = present(env[LLM_API_KEY_VAR]) ?? vendorKeyFor(provider, env);
  if (apiKey === undefined) return empty;
  const explicitModel = present(env[LLM_MODEL_VAR]);
  const model = explicitModel ?? defaultModelFor(provider);
  if (model === undefined) return empty;
  return {
    overlay: {
      [LLM_PROVIDER_VAR]: provider,
      [LLM_API_KEY_VAR]: apiKey,
      [LLM_MODEL_VAR]: model,
    },
    modelDefaulted: explicitModel === undefined,
  };
};

// A resolver that overlays the doctor's derived LLM values on top of the SAME
// ambient environment the overlay was derived from, so config/elliott.yaml's
// ${ENV:ELLIOTT_LLM_*} references resolve without the operator exporting them by
// hand. A blank (whitespace-only) value from EITHER source resolves to undefined,
// so a `${ENV:…}` reference to it fails the load naming the variable — the same
// missing-key path the empty overlay triggers. Without this the overlay could
// reject a blank key while the resolver read it back from the environment,
// sending a blank credential to the endpoint instead. The ambient env is passed
// in (not read from the module) so overlay and resolution share one view.
const overlayResolver = (
  overlay: Readonly<Record<string, string>>,
  ambient: DoctorEnv,
): SecretResolver => ({
  env: (name) => present(overlay[name] ?? ambient[name]),
  vault: (path, field) => envBackedSecretResolver.vault(path, field),
});

// Drop the control-plane secrets the real runtime also withholds from skills
// (the governance kill-switch token and the evolution control block) before the
// doctor hands settings to any skill or the probe. These enter through the
// ambient environment rather than the resolver, so this — not the recording
// resolver — is what keeps them out of operator-facing output, matching how the
// runtime scopes skill-facing settings.
export const withoutControlPlaneSecrets = (
  settings: RuntimeSettings,
): RuntimeSettings => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { governance, evolutionRuntime, ...rest } = settings;
  return governance === undefined
    ? rest
    : { ...rest, governance: { deny: governance.deny } };
};

// A config-load failure is operator-facing but untrusted: a YAML parser echoes
// the offending source line (which may hold a hardcoded secret) as a multi-line
// code frame. Order matters — REDACT first, then take the first line, then
// flatten. Redacting before truncation means a recorded secret that itself spans
// lines (its value contains a newline) is scrubbed whole; truncating first would
// keep its first-line prefix, which no post-truncation match would then catch.
export const configErrorLine = (
  error: unknown,
  secrets: readonly string[],
): string =>
  oneLine(
    stripUrlUserinfo(
      dropCodeFrame(redactSecrets(cleanMessage(error), secrets)),
    ),
  );

// Load the packages the doctor checks: the framework's bundled skills from the
// framework package, plus the deployment's agent-local skills from the consumer
// root — the same set the runtime assembles (minus registry-installed skills,
// which need the installer and a network the doctor deliberately does not use).
const loadDoctorPackages = async (
  roots: DoctorRoots,
): Promise<readonly BundledPackage[]> => [
  ...await loadBundledPackages(roots.frameworkRoot),
  ...await loadAgentSkillPackages(roots.agentRoot, roots.agentName),
];

// The credentials hint helps only when the doctor had no credentials to supply
// (an empty overlay: no vendor key, no explicit provider). When credentials ARE
// present, a config failure is about the config itself — an unknown provider, a
// malformed file — so the error names that on its own, without a misleading
// "set your keys" footer.
const configErrorHint = (overlay: Readonly<Record<string, string>>): string =>
  Object.keys(overlay).length === 0 ? `\n\n${MISSING_CONFIG_HINT}` : "";

// Handle `elliott doctor`. Returns true once it owns the argv (so other CLI
// handlers stand down), setting a nonzero exit code on any failure — a missing
// config, a configuration error, a failed probe, an egress breach, or a skill
// that failed to load. Settings, the agent definition, secrets, and agent-local
// skills come from the deployment root (the consumer's working directory);
// bundled skills come from the framework package. Prints the full report before
// exiting so a failure is diagnosed, not just signalled.
export const runDoctorCli = async (
  argv: readonly string[],
  roots: DoctorRoots,
  // The overlay-aware environment (process env plus the ELLIOTT_SECRETS_FILE
  // mount), NOT Bun.env — so a vendor key supplied through the mounted secrets
  // file is seen, not reported missing.
  env: DoctorEnv = runtimeEnvironment,
): Promise<boolean> => {
  if (argv[0] !== DOCTOR_COMMAND) return false;
  const { overlay, modelDefaulted } = doctorEnvOverlay(env);
  // Collect every resolved secret the load touches into one set — the doctor's
  // redaction set, complete by construction and secret-only: the config boundary
  // decides what is secret by the field's role, so a plain provider/model/timezone
  // diagnosis keeps its real value while every credential is captured (see
  // loadRuntimeSettings' onSecret).
  const secretValues = new Set<string>();
  const recorded = (): readonly string[] => [...secretValues];
  const resolver: SecretResolver = {
    ...overlayResolver(overlay, env),
    onSecret: (value) => secretValues.add(value),
  };
  let loaded;
  try {
    loaded = await loadRuntimeSettings(
      roots.agentRoot,
      roots.agentName,
      resolver,
    );
  } catch (error) {
    // Redact everything captured BEFORE the failure — a reference resolved during
    // the load (say a secret-bearing field interpolating ${ENV:DB_PASSWORD}) is
    // already in the set and would otherwise surface in the validation error.
    // Every printing path uses the same set.
    console.error(
      `elliott doctor: ${configErrorLine(error, recorded())}`
        + configErrorHint(overlay),
    );
    process.exitCode = 1;
    return true;
  }
  if (modelDefaulted) {
    console.log(
      `Using default model ${loaded.model} `
        + `(override with ${LLM_MODEL_VAR}).`,
    );
  }
  const settings = withoutControlPlaneSecrets(loaded);
  await reportDoctorRun(roots, settings, recorded);
  return true;
};

// A fixed phrase for a fault that escapes the harness. Everything reaching this
// catch is UNEXPECTED — runDoctor returns an ok:false report for every expected
// failure — so the thrown message is untrusted (a package-loader error quotes a
// field of an agent-local manifest verbatim, e.g. `Unsupported bundled kind
// <attacker text>`). The message is therefore NOT forwarded; the doctor states
// only what it derived: the run could not complete.
const UNEXPECTED_FAILURE =
  "the run could not complete (an internal error, or a malformed skill package "
  + "in the deployment)";

// Run the harness and print its report, setting the exit code from the verdict.
const reportDoctorRun = async (
  roots: DoctorRoots,
  settings: RuntimeSettings,
  recorded: () => readonly string[],
): Promise<void> => {
  try {
    const report = await runDoctor(
      { roots, settings, secretValues: recorded() },
      defaultDoctorDependencies(
        loadDoctorPackages,
        (packages, seed) => loadSkillRegistrations(packages, seed),
        (resolved) => new RuntimeModelClient(resolved),
      ),
    );
    console.log(formatReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error(`elliott doctor: ${UNEXPECTED_FAILURE}`);
    process.exitCode = 1;
  }
};

// Resolve the deployment root (the consumer's working directory) and agent
// name from the environment, pairing them with the framework package root.
export const doctorRoots = (
  frameworkRoot: string,
  agentRoot: string,
  env: DoctorEnv = runtimeEnvironment,
): DoctorRoots => ({
  frameworkRoot,
  agentRoot,
  agentName: env[AGENT_NAME_VAR] ?? DEFAULT_AGENT_NAME,
});
