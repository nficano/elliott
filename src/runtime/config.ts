/* eslint-disable max-lines, max-lines-per-function */
import * as Effect from "effect/Effect";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { decodeEvolutionConfig } from "../learning/evolution/config";
import { isJsonRecord } from "../providers/http";
import {
  mcpSettings,
  optionalBlueBubbles,
  optionalGmail,
  optionalNumberAt,
  optionalSlack,
  optionalStringProperty,
  optionalValue,
  stringArrayAt,
  stringAt,
} from "./settings";
import {
  optionalCloudflared,
  optionalFiles,
  optionalHomeAssistant,
  optionalSmtp,
  optionalSsh,
  optionalTerminal,
} from "./settings-tools";
import type {
  RuntimeEvolutionSettings,
  RuntimeSettings,
  SecretResolver,
} from "./types";

const DEFAULT_PORT = 8080;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.4;
const environment = Bun.env;

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

export const loadRuntimeSettings = async (
  root: string,
  resolver: SecretResolver = envBackedSecretResolver,
): Promise<RuntimeSettings> => {
  const config = await loadYaml(path.join(root, "config/elliott.yaml"));
  const secrets = await loadSecrets(root, resolver);
  const agent = await loadYaml(path.join(root, "agents/elliott.yaml"));
  const evolution = await loadEvolutionConfig(root);
  const resolved = await resolveTree(config, resolver);
  return {
    ...coreSettings(root, resolved, agent),
    ...optionalSettings(root, resolved, secrets),
    mcp: mcpSettings(agent, secrets),
    ...(evolution !== undefined && { evolution }),
    ...runtimeEvolutionSettings(),
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
    port: optionalNumberAt(resolved, ["runtime", "http", "port"])
      ?? DEFAULT_PORT,
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
    browser: {
      baseUrl: stringAt(resolved, ["browser", "daemon_url"]),
      token: stringAt(resolved, ["browser", "token"]),
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
  ...optionalSlack(resolved),
  ...optionalGmail(secrets),
  ...optionalBlueBubbles(resolved, secrets),
  ...optionalFiles(resolved, root),
  ...optionalTerminal(resolved, root),
  ...optionalSsh(resolved, secrets),
  ...optionalSmtp(resolved, secrets),
  ...optionalHomeAssistant(resolved, secrets),
  ...optionalCloudflared(resolved),
  ...optionalStringProperty("glitchtipDsn", resolved, [
    "observability",
    "glitchtip",
    "dsn",
  ]),
  ...optionalStringProperty("postgresDsn", resolved, ["store", "dsn"]),
});

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
