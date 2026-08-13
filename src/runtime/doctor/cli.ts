import { loadBundledPackages } from "../../catalog/bundled";
import {
  envBackedSecretResolver,
  loadRuntimeSettings,
  runtimeEnvironment,
} from "../config";
import { RuntimeModelClient } from "../model/client";
import { loadSkillRegistrations } from "../skills/loader";
import type { SecretResolver } from "../types";
import { formatReport } from "./format";
import { defaultDoctorDependencies, runDoctor } from "./harness";
import { cleanMessage } from "./message";
import type { DoctorEnv, DoctorEnvOverlay } from "./types";

const DOCTOR_COMMAND = "doctor";
const AGENT_NAME = "elliott";

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

// Handle `elliott doctor`. Returns true once it owns the argv (so other CLI
// handlers stand down), setting a nonzero exit code on any failure — a missing
// config, a configuration error, a failed probe, an egress breach, or a skill
// that failed to load. Prints the full report before exiting so a failure is
// diagnosed, not just signalled.
export const runDoctorCli = async (
  argv: readonly string[],
  root: string,
  env: DoctorEnv = Bun.env,
): Promise<boolean> => {
  if (argv[0] !== DOCTOR_COMMAND) return false;
  const { overlay, modelDefaulted } = doctorEnvOverlay(env);
  const resolver = overlayResolver(overlay);
  let settings;
  try {
    settings = await loadRuntimeSettings(root, AGENT_NAME, resolver);
  } catch (error) {
    console.error(
      `elliott doctor: ${cleanMessage(error)}\n\n${MISSING_CONFIG_HINT}`,
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
  const deps = defaultDoctorDependencies(
    (packageRoot) => loadBundledPackages(packageRoot),
    (packages, seed) => loadSkillRegistrations(packages, seed),
    (resolved) => new RuntimeModelClient(resolved),
  );
  const report = await runDoctor({ frameworkRoot: root, settings }, deps);
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
  return true;
};
