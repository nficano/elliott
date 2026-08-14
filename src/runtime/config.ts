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
  parseEffort,
  parseThinking,
  resolveLlmEndpoint,
} from "./model/providers";
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
  optionalSearchDuckDuckGo,
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
  // Distinguish "could not read the file" (missing, permissions) from "read it
  // and it was not valid JSON" — the two failures need different fixes. Neither
  // message echoes the file's bytes: it holds secrets, and a JSON parse error
  // would quote the offending source. The cause is kept for local debugging.
  let raw: string;
  try {
    raw = read(file);
  } catch (error) {
    throw new Error(
      `${SECRETS_FILE_VARIABLE} ${file} could not be read`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${SECRETS_FILE_VARIABLE} ${file} is not valid JSON`,
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

// The ambient process environment BEFORE the ELLIOTT_SECRETS_FILE overlay.
// Non-secret deployment metadata that is TRANSMITTED off-box in error telemetry
// (ELLIOTT_ENV, ELLIOTT_RELEASE) is read from here, never from `environment`:
// those two values ride in every GlitchTip envelope, so they must not be
// sourceable from the secrets file, which holds the secrets Elliott resolves.
const processEnv: Readonly<Record<string, string | undefined>> = Bun.env;

const environment: Readonly<Record<string, string | undefined>> = {
  ...processEnv,
  ...readMountedSecrets(processEnv),
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
// Transmitted in error telemetry — sourced from the ambient env only, never the
// secrets-file overlay (see processEnv above).
export const runtimeName = processEnv["ELLIOTT_ENV"] ?? "prod";

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

// A value is an opaque secret reference when it is exactly one `${ENV:VAR}` or
// `${VAULT:mount/path#field}` expression — the only forms resolveExpression
// resolves. Anything else in a secret-bearing field is a literal credential.
const ENV_REFERENCE = /^\$\{ENV:[^}]+\}$/;
const VAULT_REFERENCE = /^\$\{VAULT:[^#}]+#[^}]+\}$/;
const isSecretReference = (value: string): boolean =>
  ENV_REFERENCE.test(value) || VAULT_REFERENCE.test(value);

const REFERENCE_FORMS =
  "an opaque reference (${ENV:VAR} or ${VAULT:mount/path#field})";

// Which config fields hold a credential, answered by the field's ROLE — the
// final word of its key — rather than a list of paths. A fixed path list can
// never cover a field owned by an agent-local skill schema under `skills.*`
// (that subtree passes through verbatim, see optionalSkillConfig); a role
// predicate covers it the day it is added, with no list for anyone to forget.
// The words are the endings that name a credential; `bot_token`, `app_token`,
// `refresh_token`, `signing_secret`, `client_secret`, `api_key`, `private_key`,
// and a bare `dsn`/`token`/`password` all match, while `base_url`, `owner_id`,
// `default_channel`, `public_hostname`, `provider`, and `model` do not. Config
// keys are snake_case, so the final `_`/`-` segment is the discriminator.
const SECRET_WORDS: ReadonlySet<string> = new Set([
  "token",
  "secret",
  "password",
  "passphrase",
  "dsn",
  "key",
  "credential",
  "credentials",
]);

const isSecretFieldName = (key: string): boolean => {
  const last = key.toLowerCase().split(/[_-]/).at(-1);
  return last !== undefined && SECRET_WORDS.has(last);
};

// A secret-bearing config field is acceptable when it is an opaque reference OR
// the NAME of a config/secrets.yaml entry. The second form is the indirection
// pattern the framework already uses (google `refresh_token_secret`, an mcp
// `authorizationSecret`, a litellm account `secret`): the field holds an
// identifier and the credential it names lives in secrets.yaml, enforced there.
// Recognising the pointer by whether its value is a declared secrets key — not by
// a hand-list of pointer field names — means a new pointer field is covered too.
// Anything else is a literal credential in the clear, a load-time error naming
// the field (never the value, which is the credential).
const assertSecretReference = (
  field: string,
  value: string,
  secretKeys: ReadonlySet<string>,
): void => {
  if (isSecretReference(value) || secretKeys.has(value)) return;
  throw new Error(
    `Secret field ${field} must be ${REFERENCE_FORMS} `
      + "or the name of a config/secrets.yaml entry, not a literal value",
  );
};

// Walk the whole config tree and enforce the reference rule on every secret-named
// field, at any depth and inside arrays — so a credential under `skills.*`, a new
// channel, or a nested account is covered without enumerating its path.
const assertConfigSecretReferences = (
  node: unknown,
  secretKeys: ReadonlySet<string>,
  pathPrefix = "",
): void => {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      assertConfigSecretReferences(item, secretKeys, `${pathPrefix}[${index}]`);
    }
    return;
  }
  if (!isJsonRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const dotted = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    if (typeof value === "string") {
      if (value.length > 0 && isSecretFieldName(key)) {
        assertSecretReference(dotted, value, secretKeys);
      }
      continue;
    }
    assertConfigSecretReferences(value, secretKeys, dotted);
  }
};

// The resolver's optional `onSecret` sink (see SecretResolver) receives every
// resolved SECRET value the load touches: the resolved value of each
// secret-bearing config field (per the secret-name schema) and every
// config/secrets.yaml entry — and NOTHING else, so an ordinary referenced setting
// (a timezone, a base_url) never enters the set and cannot mangle output. The
// doctor supplies a sink to obtain the redaction set complete by construction, no
// maintained list of where secrets live.
export const loadRuntimeSettings = async (
  root: string,
  agentName = "elliott",
  resolver: SecretResolver = envBackedSecretResolver,
): Promise<RuntimeSettings> => {
  const config = await stripDisabledGlitchtipDsn(
    await loadYaml(path.join(root, "config/elliott.yaml")),
    resolver,
  );
  const rawSecrets = await loadYaml(path.join(root, "config/secrets.yaml"));
  const secretKeys: ReadonlySet<string> = new Set(
    isJsonRecord(rawSecrets) ? Object.keys(rawSecrets) : [],
  );
  assertConfigSecretReferences(config, secretKeys);
  const secrets = await resolveSecrets(rawSecrets, resolver);
  const agent = await loadAgentDefinition(root, agentName);
  const evolution = await loadEvolutionConfig(root);
  const resolved = await resolveTree(config, resolver);
  // The GlitchTip DSN's fallback source is a direct env var, not a config-tree
  // reference, so record it here — it is a secret and reaches settings.
  const glitchtipDsn = resolver.env("ELLIOTT_GLITCHTIP_DSN");
  if (glitchtipDsn !== undefined && glitchtipDsn.length > 0) {
    resolver.onSecret?.(glitchtipDsn);
  }
  return {
    ...coreSettings(root, resolved, agent),
    ...optionalSettings(root, resolved, secrets),
    ...optionalGlitchTip(resolved, glitchtipDsn),
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
  const endpoint = resolveLlmEndpoint(
    optionalStringAt(resolved, ["llm", "provider"]),
    optionalStringAt(resolved, ["llm", "base_url"]),
  );
  const thinking = parseThinking(
    optionalStringAt(resolved, ["llm", "profiles", "default", "thinking"]),
  );
  const effort = parseEffort(
    optionalStringAt(resolved, ["llm", "profiles", "default", "effort"]),
  );
  return {
    environment: runtimeName,
    release: processEnv["ELLIOTT_RELEASE"] ?? "dev",
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
    llmBaseUrl: endpoint.baseUrl,
    llmWire: endpoint.wire,
    llmApiKey: stringAt(resolved, ["llm", "api_key"]),
    ...(thinking !== undefined && { thinking }),
    ...(effort !== undefined && { effort }),
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
  ...optionalSearchDuckDuckGo(resolved),
  ...optionalValue("webhookSecret", secrets["webhook_signing_secret"]),
  ...optionalValue("webhookGatewaySecret", secrets["webhook_gateway_secret"]),
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

// Resolve config/secrets.yaml. Every entry is a secret, so each must be an opaque
// reference (a literal here would enter settings without passing through the
// resolver) and each resolved value is handed to `onSecret` — this is what makes
// the secret set cover secrets.yaml completely, including the credential a config
// pointer field (a litellm account `secret`, a google `refresh_token_secret`)
// names. A secret that cannot be resolved is omitted, not fatal: the skills that
// need it stay unregistered while the rest of the runtime boots.
const resolveSecrets = async (
  raw: unknown,
  resolver: SecretResolver,
): Promise<Readonly<Record<string, string>>> => {
  const output: Record<string, string> = {};
  if (!isJsonRecord(raw)) return output;
  const entries = await Promise.all(
    Object.entries(raw).map(async ([key, value]) => {
      if (typeof value !== "string") {
        throw new TypeError(`Secret ${key} is not text`);
      }
      assertSecretReference(`config/secrets.yaml#${key}`, value, new Set());
      try {
        return [key, await resolveExpression(value, resolver)] as const;
      } catch {
        return undefined;
      }
    }),
  );
  for (const entry of entries) {
    if (entry === undefined) continue;
    output[entry[0]] = entry[1];
    resolver.onSecret?.(entry[1]);
  }
  return output;
};

// Resolve every `${ENV:…}`/`${VAULT:…}` reference in the config tree. Recording
// is driven by the FIELD, not the resolver: only a secret-named field whose value
// was a reference hands its resolved value to `onSecret`. A non-secret reference
// (a timezone, a base_url) resolves normally but is never recorded, so it cannot
// mangle diagnostic output; a pointer field (its value is a secrets.yaml key, not
// a reference) is not recorded here — the credential it names is recorded by
// resolveSecrets instead.
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
    Object.entries(value).map(async ([key, item]) => {
      const resolvedItem = await resolveTree(item, resolver);
      if (
        typeof item === "string" && typeof resolvedItem === "string"
        && isSecretFieldName(key) && isSecretReference(item)
      ) {
        resolver.onSecret?.(resolvedItem);
      }
      return [key, resolvedItem] as const;
    }),
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
