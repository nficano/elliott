import {
  loadAgentSkillPackages,
  loadBundledPackages,
} from "../../catalog/bundled";
import type { BundledPackage } from "../../catalog/types";
import {
  envBackedSecretResolver,
  loadRuntimeSettings,
  resolveSecretValues,
  runtimeEnvironment,
} from "../config";
import { RuntimeModelClient } from "../model/client";
import { loadSkillRegistrations } from "../skills/loader";
import type { SecretResolver } from "../types";
import { formatReport } from "./format";
import { defaultDoctorDependencies, runDoctor } from "./harness";
import { cleanMessage, firstLine, sanitizeForDisplay } from "./message";
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

const inferProvider = (env: DoctorEnv): string | undefined => {
  if (env[ANTHROPIC_KEY_VAR] !== undefined) return "anthropic";
  if (env[OPENAI_KEY_VAR] !== undefined) return "openai";
  return undefined;
};

const vendorKeyFor = (provider: string, env: DoctorEnv): string | undefined => {
  if (provider === "anthropic") return env[ANTHROPIC_KEY_VAR];
  if (provider === "openai") return env[OPENAI_KEY_VAR];
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
  const provider = env[LLM_PROVIDER_VAR] ?? inferProvider(env);
  if (provider === undefined) return empty;
  const apiKey = env[LLM_API_KEY_VAR] ?? vendorKeyFor(provider, env);
  if (apiKey === undefined) return empty;
  const explicitModel = env[LLM_MODEL_VAR];
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

// A resolver that overlays the doctor's derived LLM values on top of the
// ambient environment, so config/elliott.yaml's ${ENV:ELLIOTT_LLM_*} references
// resolve without the operator having to export them by hand.
const overlayResolver = (
  overlay: Readonly<Record<string, string>>,
): SecretResolver => ({
  env: (name) => overlay[name] ?? runtimeEnvironment[name],
  vault: (path, field) => envBackedSecretResolver.vault(path, field),
});

// A config-load failure is operator-facing but untrusted: a YAML parser echoes
// the offending source line (which may hold a hardcoded secret) as a multi-line
// code frame. Reduce it to its first line — the description, never the frame —
// then scrub any secret and flatten it, so neither a credential nor a forged
// line can reach the terminal. `secrets` are only the actual secret values
// (derived, not the whole overlay), so a plain invalid-config error — an
// unknown provider, a bad model — still prints its real value.
export const configErrorLine = (
  error: unknown,
  secrets: readonly string[],
): string => sanitizeForDisplay(firstLine(cleanMessage(error)), secrets);

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
  env: DoctorEnv = Bun.env,
): Promise<boolean> => {
  if (argv[0] !== DOCTOR_COMMAND) return false;
  const { overlay, modelDefaulted } = doctorEnvOverlay(env);
  const resolver = overlayResolver(overlay);
  let settings;
  try {
    settings = await loadRuntimeSettings(
      roots.agentRoot,
      roots.agentName,
      resolver,
    );
  } catch (error) {
    // Pre-load, the only secret the doctor holds is the LLM key it injected
    // into the overlay (never provider/model — those are not secrets).
    const overlayKey = overlay[LLM_API_KEY_VAR];
    const secrets = overlayKey === undefined ? [] : [overlayKey];
    console.error(
      `elliott doctor: ${configErrorLine(error, secrets)}`
        + configErrorHint(overlay),
    );
    process.exitCode = 1;
    return true;
  }
  if (modelDefaulted) {
    console.log(
      `Using default model ${settings.model} `
        + `(override with ${LLM_MODEL_VAR}).`,
    );
  }
  // The authoritative secret set for redaction, from the config boundary.
  const secretValues = await resolveSecretValues(roots.agentRoot, resolver);
  const deps = defaultDoctorDependencies(
    loadDoctorPackages,
    (packages, seed) => loadSkillRegistrations(packages, seed),
    (resolved) => new RuntimeModelClient(resolved),
  );
  const report = await runDoctor({ roots, settings, secretValues }, deps);
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
  return true;
};

// Resolve the deployment root (the consumer's working directory) and agent
// name from the environment, pairing them with the framework package root.
export const doctorRoots = (
  frameworkRoot: string,
  agentRoot: string,
  env: DoctorEnv = Bun.env,
): DoctorRoots => ({
  frameworkRoot,
  agentRoot,
  agentName: env[AGENT_NAME_VAR] ?? DEFAULT_AGENT_NAME,
});
