// The runtime-facing half of the consumer scaffold: everything
// loadRuntimeSettings and ElliottRuntime need to boot the scaffolded repo as
// an agent root. Required LLM fields are env-backed with no baked-in endpoint
// or model — a missing variable fails the boot naming it
// (docs/reference/configuration.md).

export const runtimeAgentYaml = (name: string): string =>
  `apiVersion: elliott/v1
kind: agent
metadata:
  namespace: local
  name: ${name}
  version: 0.1.0
spec:
  persona: assets/prompts/${name}.md
  modelProfile: default
  components:
    - core/mcp-endpoint/mcp-client
    - core/tool/fetch
    - core/tool/files
    - core/tool/terminal
    - core/tool/ssh
    - core/scheduler/scheduler
    - core/extension/deep-trace
  # External MCP servers this agent connects to. Example:
  #
  # mcp:
  #   - id: example
  #     url: https://mcp.example.com/mcp
  #     transport: streamable-http
`;

export const personaMarkdown = (name: string): string =>
  `You are ${name}, a personal agent built on Elliott.

Replace this file with the agent's real persona: who it is, how it speaks,
and what it refuses. The runtime loads it as the system persona for every
turn.
`;

export const RUNTIME_CONFIG_YAML = `runtime:
  timezone: UTC
  http: { port: 8080 }

store:
  # Optional external Postgres store. Omit \`dsn\` to run on the embedded
  # SQLite default. To enable:
  # dsn: \${ENV:ELLIOTT_POSTGRES_DSN}
  pool: { max: 10 }
  vectors: { dim: 768, type: vector }

llm:
  # Any OpenAI-compatible endpoint: a provider's native /v1, a LiteLLM
  # proxy, or a local server. No endpoint or model ships as a default —
  # set these environment variables or replace the expressions with
  # literals. A missing variable fails the boot naming it.
  base_url: \${ENV:ELLIOTT_LLM_BASE_URL} # e.g. https://api.example.com/v1
  api_key: \${ENV:ELLIOTT_LLM_API_KEY}
  max_parallel: 12
  models:
    # Agents select a tier by name (spec.modelProfile), never a hardcoded
    # model. Add tiers (fast, standard, deep, …) as your deployment needs.
    default:
      model: \${ENV:ELLIOTT_LLM_MODEL}
      context_window: 128000
  profiles:
    default: { max_tokens: 4096, temperature: 0.4 }

budgets:
  cold_tokens_max: 12000
  monthly_usd_max: 200
  per_turn_usd_max: 2

observability:
  # Sentry-compatible error reporting (GlitchTip or Sentry). ON by default and
  # needs no setup: errors always log to the console, and with the bundled
  # collector companion they also ship there automatically. Set \`dsn\` to use
  # your own Sentry/GlitchTip, or \`enabled: false\` to stay console-only.
  glitchtip:
    enabled: true
    # dsn: \${ENV:ELLIOTT_GLITCHTIP_DSN}

notify:
  webhook_url: ""
  default_channels: []

tools:
  files:
    enabled: true
    root: .elliott-runtime/workspace
  terminal:
    enabled: false
    root: .elliott-runtime/workspace
    allowed_commands: []
  ssh:
    enabled: false
    user: elliott
    hosts: []
  # HashiCorp Vault, off by default. Enable it AND set an address, a token
  # (secrets.yaml \`vault_token\`), and a non-empty \`paths\` allowlist; it fails
  # closed, so an empty allowlist leaves the skill unregistered.
  vault:
    enabled: false
    address: "" # e.g. https://vault.internal:8200
    paths: [] # full KV v2 API paths, e.g. secret/data/myapp

skills:
  deep_trace:
    enabled: true
`;

export const RUNTIME_SECRETS_YAML =
  `# Named secrets the runtime resolves at boot and hands to components
# through the secret broker. Values are opaque references — \`\${ENV:VAR}\`
# for the process environment (or the ELLIOTT_SECRETS_FILE mount), or
# \`\${VAULT:mount/path#field}\` for HashiCorp Vault KV — never literal
# secrets. A reference that does not resolve is omitted, not fatal: the
# skills that need it stay unregistered while the rest of the runtime
# boots. Name here every key your agent's skills consume.
ssh_private_key: \${ENV:ELLIOTT_SSH_PRIVATE_KEY}
webhook_signing_secret: \${ENV:ELLIOTT_WEBHOOK_SIGNING_SECRET}
# Only when tools.vault.enabled — the token the vault skill reads with.
# vault_token: \${ENV:ELLIOTT_VAULT_TOKEN}
`;

// Boots the installed elliott package (frameworkRoot) against this
// repository (agentRoot) — the same split the production deployable uses.
export const runtimeMain = (name: string): string =>
  `import path from "node:path";
import { ElliottRuntime } from "elliott/runtime/app";

const frameworkRoot = path.dirname(
  Bun.resolveSync("elliott/package.json", import.meta.dir),
);
const runtime = new ElliottRuntime({
  frameworkRoot,
  agentRoot: import.meta.dir,
  agentName: "${name}",
});

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await runtime.start();
`;

export const GITIGNORE = `node_modules/
.elliott-runtime/
.elliott/skills/
`;
