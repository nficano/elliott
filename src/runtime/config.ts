/* eslint-disable max-lines, max-lines-per-function */
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { parseInstallSettings } from "../install/index";
import { decodeEvolutionConfig } from "../learning/evolution/config";
import { isJsonRecord } from "../providers/http";
import {
  mcpSettings,
  optionalBlueBubbles,
  optionalGmail,
  optionalGoogle,
  optionalNumberAt,
  optionalSlack,
  optionalStringAt,
  optionalStringProperty,
  optionalValue,
  stringArrayAt,
  stringAt,
} from "./settings";
import {
  glitchtipExplicitlyDisabled,
  optionalGlitchTip,
} from "./settings-observability";
import {
  optionalDeepTrace,
  optionalNewsBrief,
  optionalSkillConfig,
} from "./settings-skills";
import {
  optionalCloudflared,
  optionalFiles,
  optionalHomeAssistant,
  optionalPihole,
  optionalSmtp,
  optionalSsh,
  optionalSubscriptionUsage,
  optionalTerminal,
  optionalTraefik,
  optionalVault,
  optionalWebhookProvisioner,
} from "./settings-tools";
import type {
  GovernanceSettings,
  InstallSettings,
  RuntimeEvolutionSettings,
  RuntimeSettings,
  SecretResolver,
} from "./types";

const DEFAULT_PORT = 8080;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.4;

// When ELLIOTT_SECRETS_FILE points at a JSON object, its entries join the
// boundary's environment view. This keeps secrets out of the container's
// process environment (docker inspect, /proc/1/environ, and the terminal
// tool's `env` all read it) — the deploy mounts a read-only file instead of
// injecting an env_file. A set-but-unreadable file fails the boot loudly:
// booting secretless would silently skip every skill that needs one.
const SECRETS_FILE_VARIABLE = "ELLIOTT_SECRETS_FILE";

export const readMountedSecrets = (
  env: Readonly<Record<string, string | undefined>>,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): Readonly<Record<string, string>> => {
  const file = env[SECRETS_FILE_VARIABLE];
  if (file === undefined || file.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(file));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${SECRETS_FILE_VARIABLE} ${file} is unreadable: ${detail}`,
      { cause: error },
    );
  }
  if (!isJsonRecord(parsed)) {
    throw new Error(
      `${SECRETS_FILE_VARIABLE} ${file} must hold a JSON object`,
    );
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

const environment: Readonly<Record<string, string | undefined>> = {
  ...Bun.env,
  ...readMountedSecrets(Bun.env),
};

// ELLIOTT_HTTP_PORT overrides the configured port for local runs (e.g. when the
// default is already taken). Falls back to config, then DEFAULT_PORT.
const httpPort = (resolved: unknown): number => {
  const override = Number(environment["ELLIOTT_HTTP_PORT"]);
  if (Number.isSafeInteger(override) && override > 0) return override;
  return optionalNumberAt(resolved, ["runtime", "http", "port"])
    ?? DEFAULT_PORT;
};

export const runtimeEnvironment = environment;
export const runtimeName = environment["ELLIOTT_ENV"] ?? "prod";

export const envBackedSecretResolver: SecretResolver = {
  env: (name) => environment[name],
  vault: async (_path, field) => {
    const value = environment[field];
    if (value === undefined) {
      throw new Error(`vault-rendered environment is missing ${field}`);
    }
    return value;
  },
};

// A disabled glitchtip never uses its `dsn`, so remove it before reference
// resolution: an unresolvable `${ENV:…}`/`${VAULT:…}` reference under a feature
// that is turned OFF must not abort boot. An ENABLED glitchtip whose dsn
// reference is unresolvable still errors loudly, which is correct — you asked
// for that endpoint. Only the explicit-off case short-circuits; the resulting
// settings are identical either way (a disabled glitchtip yields no settings).
const stripDisabledGlitchtipDsn = async (
  config: unknown,
  resolver: SecretResolver,
): Promise<unknown> => {
  if (!isJsonRecord(config)) return config;
  const observability = config["observability"];
  if (!isJsonRecord(observability)) return config;
  const glitchtip = observability["glitchtip"];
  if (!isJsonRecord(glitchtip) || !("dsn" in glitchtip)) return config;
  // Resolve `enabled` FIRST — it may itself be a `${ENV:…}`/`${VAULT:…}`
  // reference — so a reference that resolves to a disabled value drops the unused
  // dsn. If `enabled` is itself unresolvable, leave the block untouched; the main
  // resolution surfaces that error.
  let enabled = glitchtip["enabled"];
  if (typeof enabled === "string") {
    try {
      enabled = await resolveExpression(enabled, resolver);
    } catch {
      return config;
    }
  }
  if (!glitchtipExplicitlyDisabled(enabled)) return config;
  return {
    ...config,
    observability: {
      ...observability,
      glitchtip: Object.fromEntries(
        Object.entries(glitchtip).filter(([key]) => key !== "dsn"),
      ),
    },
  };
};

export const loadRuntimeSettings = async (
  root: string,
  agentName = "elliott",
  resolver: SecretResolver = envBackedSecretResolver,
): Promise<RuntimeSettings> => {
  const config = await stripDisabledGlitchtipDsn(
    await loadYaml(path.join(root, "config/elliott.yaml")),
    resolver,
  );
  const secrets = await loadSecrets(root, resolver);
  const agent = await loadAgentDefinition(root, agentName);
  const evolution = await loadEvolutionConfig(root);
  const resolved = await resolveTree(config, resolver);
  return {
    ...coreSettings(root, resolved, agent),
    ...optionalSettings(root, resolved, secrets),
    mcp: mcpSettings(agent, secrets),
    ...(evolution !== undefined && { evolution }),
    ...runtimeEvolutionSettings(),
    ...governanceSettings(resolved),
    ...installSettings(resolved),
  };
};

// Parse the `install:` block (installable skills) off the resolved config.
// Absent block → no install settings; grammar/duplicate errors are fatal.
const installSettings = (
  resolved: unknown,
): { readonly install?: InstallSettings; } => {
  const block = isJsonRecord(resolved) ? resolved["install"] : undefined;
  const parsed = parseInstallSettings(block);
  return parsed === undefined ? {} : { install: parsed };
};

// Governance is always present so audit + identity run for every agent. The
// deny list is declarative config; the kill-switch route only opens when the
// control token is provided out-of-band via the environment.
const governanceSettings = (
  resolved: unknown,
): { readonly governance: GovernanceSettings; } => {
  const controlToken = environment["ELLIOTT_GOVERNANCE_TOKEN"];
  return {
    governance: {
      deny: stringArrayAt(resolved, ["governance", "deny"]),
      ...(controlToken !== undefined && { controlToken }),
    },
  };
};

const commaSeparated = (value: string | undefined): readonly string[] =>
  value === undefined
    ? []
    : value.split(",").map((item) => item.trim()).filter(Boolean);

const runtimeEvolutionSettings = (): {
  readonly evolutionRuntime?: RuntimeEvolutionSettings;
} => {
  const controlToken = environment["ELLIOTT_EVOLUTION_CONTROL_TOKEN"];
  const operatorPrincipalId =
    environment["ELLIOTT_EVOLUTION_OPERATOR_PRINCIPAL"];
  const capabilities = commaSeparated(
    environment["ELLIOTT_EVOLUTION_OPERATOR_CAPABILITIES"],
  );
  if (
    controlToken === undefined || operatorPrincipalId === undefined
    || capabilities.length === 0
  ) return {};
  return {
    evolutionRuntime: {
      controlToken,
      operatorPrincipalId,
      operatorCapabilities: capabilities,
      agentCapabilities: commaSeparated(
        environment["ELLIOTT_EVOLUTION_AGENT_CAPABILITIES"],
      ),
      schedulerCapabilities: commaSeparated(
        environment["ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES"],
      ),
      ...optionalValue(
        "dspyEndpoint",
        environment["ELLIOTT_EVOLUTION_DSPY_URL"],
      ),
      ...optionalValue(
        "darwinianEndpoint",
        environment["ELLIOTT_EVOLUTION_DARWINIAN_URL"],
      ),
      ...optionalValue(
        "evaluatorEndpoint",
        environment["ELLIOTT_EVOLUTION_EVALUATOR_URL"],
      ),
      ...optionalValue(
        "evaluatorToken",
        environment["ELLIOTT_EVOLUTION_EVALUATOR_TOKEN"],
      ),
      ...optionalValue(
        "candidateCheckEndpoint",
        environment["ELLIOTT_EVOLUTION_CANDIDATE_CHECK_URL"],
      ),
      ...optionalValue(
        "canaryEndpoint",
        environment["ELLIOTT_EVOLUTION_CANARY_URL"],
      ),
      ...optionalValue(
        "authoringRouteDigest",
        environment["ELLIOTT_EVOLUTION_AUTHORING_ROUTE_DIGEST"],
      ),
      ...optionalValue(
        "evaluationRouteDigest",
        environment["ELLIOTT_EVOLUTION_EVALUATION_ROUTE_DIGEST"],
      ),
      ...optionalValue(
        "schedulerPrincipalId",
        environment["ELLIOTT_EVOLUTION_SCHEDULER_PRINCIPAL"],
      ),
    },
  };
};

const loadEvolutionConfig = async (
  root: string,
): Promise<RuntimeSettings["evolution"]> => {
  const filePath = path.join(root, ".elliott/evolution.yaml");
  try {
    await access(filePath);
  } catch {
    return undefined;
  }
  const input = await loadYaml(filePath);
  return Effect.runPromise(decodeEvolutionConfig(input));
};

const coreSettings = (
  root: string,
  resolved: unknown,
  agent: unknown,
): RuntimeSettings => {
  const modelProfile = stringAt(agent, ["spec", "modelProfile"]);
  return {
    environment: runtimeName,
    release: environment["ELLIOTT_RELEASE"] ?? "dev",
    timezone: stringAt(resolved, ["runtime", "timezone"]),
    port: httpPort(resolved),
    persona: path.join(root, stringAt(agent, ["spec", "persona"])),
    model: stringAt(resolved, ["llm", "models", modelProfile, "model"]),
    maxTokens: optionalNumberAt(
      resolved,
      ["llm", "profiles", "default", "max_tokens"],
    ) ?? DEFAULT_MAX_TOKENS,
    temperature: optionalNumberAt(
      resolved,
      ["llm", "profiles", "default", "temperature"],
    ) ?? DEFAULT_TEMPERATURE,
    llmBaseUrl: stringAt(resolved, ["llm", "base_url"]),
    llmApiKey: stringAt(resolved, ["llm", "api_key"]),
    stateDirectory: path.join(root, ".elliott-runtime"),
    // The browser skill moved to the nficano/skills registry; its config block
    // is optional now. The field stays on RuntimeSettings (transitional, like
    // the other moved-skill settings loaders) and tolerates an absent block so
    // a built-ins-only elliott still boots.
    browser: {
      baseUrl: optionalStringAt(resolved, ["browser", "daemon_url"]) ?? "",
      token: optionalStringAt(resolved, ["browser", "token"]) ?? "",
      allowedDomains: stringArrayAt(resolved, ["browser", "allowed_domains"]),
    },
    mcp: [],
  };
};

const optionalSettings = (
  root: string,
  resolved: unknown,
  secrets: Readonly<Record<string, string>>,
): Partial<RuntimeSettings> => ({
  ...optionalValue("braveApiKey", secrets["brave_api_key"]),
  ...optionalValue("firecrawlApiKey", secrets["firecrawl_api_key"]),
  ...optionalValue("parallelApiKey", secrets["parallel_api_key"]),
  ...optionalValue("webhookSecret", secrets["webhook_signing_secret"]),
  ...optionalSlack(resolved, secrets),
  ...optionalGmail(resolved, secrets),
  ...optionalGoogle(resolved, secrets),
  ...optionalBlueBubbles(resolved, secrets),
  ...optionalFiles(resolved, root),
  ...optionalTerminal(resolved, root),
  ...optionalSsh(resolved, secrets),
  ...optionalSmtp(resolved, secrets),
  ...optionalHomeAssistant(resolved, secrets),
  ...optionalCloudflared(resolved),
  ...optionalPihole(resolved, secrets),
  ...optionalTraefik(resolved),
  ...optionalVault(resolved, secrets),
  ...optionalWebhookProvisioner(resolved),
  ...optionalDeepTrace(resolved),
  ...optionalSubscriptionUsage(resolved, secrets),
  ...optionalGlitchTip(resolved, environment["ELLIOTT_GLITCHTIP_DSN"]),
  ...optionalStringProperty("postgresDsn", resolved, ["store", "dsn"]),
  ...optionalNewsBrief(resolved, secrets),
  ...optionalSkillConfig(resolved),
});

// The agent definition lives at agents/<name>/agent.yaml (the agent-repo
// layout); older single-root checkouts keep the flat agents/<name>.yaml. Try
// the nested form first, fall back to flat.
const loadAgentDefinition = async (
  root: string,
  agentName: string,
): Promise<unknown> => {
  const nested = path.join(root, "agents", agentName, "agent.yaml");
  try {
    await access(nested);
    return await loadYaml(nested);
  } catch {
    return loadYaml(path.join(root, "agents", `${agentName}.yaml`));
  }
};

const loadYaml = async (file: string): Promise<unknown> => {
  const raw = await readFile(file, "utf8");
  const value: unknown = parse(raw);
  if (!isJsonRecord(value)) throw new Error(`${file} must contain a mapping`);
  return value;
};

const loadSecrets = async (
  root: string,
  resolver: SecretResolver,
): Promise<Readonly<Record<string, string>>> => {
  const raw = await loadYaml(path.join(root, "config/secrets.yaml"));
  const output: Record<string, string> = {};
  if (!isJsonRecord(raw)) return output;
  const entries = await Promise.all(
    Object.entries(raw).map(async ([key, value]) => {
      if (typeof value !== "string") {
        throw new TypeError(`Secret ${key} is not text`);
      }
      // A secret that cannot be resolved is omitted, not fatal: the skills
      // that need it stay unregistered while the rest of the runtime boots.
      try {
        return [key, await resolveExpression(value, resolver)] as const;
      } catch {
        return undefined;
      }
    }),
  );
  for (const entry of entries) {
    if (entry !== undefined) output[entry[0]] = entry[1];
  }
  return output;
};

const resolveTree = async (
  value: unknown,
  resolver: SecretResolver,
): Promise<unknown> => {
  if (typeof value === "string") return resolveExpression(value, resolver);
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveTree(item, resolver)));
  }
  if (!isJsonRecord(value)) return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) =>
      [key, await resolveTree(item, resolver)] as const
    ),
  );
  return Object.fromEntries(entries);
};

const resolveExpression = async (
  value: string,
  resolver: SecretResolver,
): Promise<string> => {
  const vault = /^\$\{VAULT:([^#}]+)#([^}]+)\}$/.exec(value);
  if (vault?.[1] !== undefined && vault[2] !== undefined) {
    return resolver.vault(vault[1], vault[2]);
  }
  const env = /^\$\{ENV:([^}]+)\}$/.exec(value);
  if (env?.[1] !== undefined) {
    const result = resolver.env(env[1]);
    if (result === undefined) {
      throw new Error(`Environment is missing ${env[1]}`);
    }
    return result;
  }
  return value;
};
