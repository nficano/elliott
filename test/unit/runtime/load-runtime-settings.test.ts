import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRuntimeSettings } from "../../../src/runtime/config";
import type { SecretResolver } from "../../../src/runtime/types";

const resolver = (
  env: Readonly<Record<string, string>> = {},
  vault: Readonly<Record<string, string>> = {},
): SecretResolver => ({
  env: (name) => env[name],
  vault: async (_path, field) => {
    const value = vault[field] ?? env[field];
    if (value === undefined) {
      throw new Error(`vault-rendered environment is missing ${field}`);
    }
    return value;
  },
});

const writeTree = async (
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "elliott-settings-"));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
};

const BASE_CONFIG = `
runtime:
  timezone: UTC
  http:
    port: 9090
llm:
  base_url: "\${ENV:LLM_BASE}"
  api_key: "\${ENV:LLM_KEY}"
  models:
    default:
      model: "\${ENV:LLM_MODEL}"
  profiles:
    default:
      max_tokens: 2048
      temperature: 0.2
tools:
  files:
    enabled: true
    root: workspace
  terminal:
    enabled: true
    root: workspace
    allowed_commands: [ls]
  ssh:
    enabled: true
    user: elliott
    hosts: [host.example]
channels:
  slack:
    enabled: true
    app_token: xapp
    bot_token: xoxb
    owner_id: U1
    default_channel: C1
skills:
  deep_trace:
    enabled: true
    public_hostname: map.example
    service_url: http://127.0.0.1:9090
  custom:
    flag: true
governance:
  deny: [tool.danger]
observability:
  glitchtip:
    dsn: https://glitchtip.example/1
store:
  dsn: postgres://local/db
install:
  registry: example/skills
  skills: [fetch]
`;

const AGENT_NESTED = `
apiVersion: elliott/v1
kind: agent
metadata: { name: elliott }
spec:
  persona: prompts/persona.md
  modelProfile: default
  mcp:
    - id: demo
      url: https://mcp.example/mcp
      transport: streamable-http
      authorizationSecret: mcp_token
`;

const SECRETS = `
ssh_private_key: "\${ENV:SSH_KEY}"
webhook_signing_secret: "\${ENV:WEBHOOK}"
brave_api_key: "\${ENV:BRAVE}"
mcp_token: "\${ENV:MCP_TOKEN}"
unresolved: "\${ENV:MISSING}"
vaulted: "\${VAULT:secret/data#vault_field}"
`;

describe("loadRuntimeSettings", () => {
  it("loads nested agent yaml, resolves secrets, and assembles optionals", async () => {
    const root = await writeTree({
      "config/elliott.yaml": BASE_CONFIG,
      "config/secrets.yaml": SECRETS,
      "agents/elliott/agent.yaml": AGENT_NESTED,
      "prompts/persona.md": "hello",
    });
    const settings = await loadRuntimeSettings(
      root,
      "elliott",
      resolver({
        LLM_BASE: "http://llm",
        LLM_KEY: "key",
        LLM_MODEL: "model-a",
        SSH_KEY: "pk",
        WEBHOOK: "wh",
        BRAVE: "brave",
        MCP_TOKEN: "mcp-auth",
      }, { vault_field: "from-vault" }),
    );

    expect(settings.timezone).toBe("UTC");
    expect(settings.port).toBe(9090);
    expect(settings.model).toBe("model-a");
    expect(settings.maxTokens).toBe(2048);
    expect(settings.temperature).toBeCloseTo(0.2);
    expect(settings.llmBaseUrl).toBe("http://llm");
    expect(settings.llmApiKey).toBe("key");
    expect(settings.persona).toBe(path.join(root, "prompts/persona.md"));
    expect(settings.files?.root).toBe(path.resolve(root, "workspace"));
    expect(settings.terminal?.allowedCommands).toEqual(["ls"]);
    expect(settings.ssh).toEqual({
      user: "elliott",
      hosts: ["host.example"],
      privateKey: "pk",
    });
    expect(settings.slack?.botToken).toBe("xoxb");
    expect(settings.braveApiKey).toBe("brave");
    expect(settings.webhookSecret).toBe("wh");
    expect(settings.deepTrace).toEqual({
      publicHostname: "map.example",
      serviceUrl: "http://127.0.0.1:9090",
    });
    expect(settings.skillConfig?.["custom"]).toEqual({ flag: true });
    expect(settings.glitchtip).toEqual({ dsn: "https://glitchtip.example/1" });
    expect(settings.postgresDsn).toBe("postgres://local/db");
    expect(settings.governance.deny).toEqual(["tool.danger"]);
    expect(settings.install?.registry).toBe("example/skills");
    expect(settings.mcp).toEqual([{
      id: "demo",
      url: "https://mcp.example/mcp",
      transport: "streamable-http",
      authorization: "mcp-auth",
    }]);
  });

  it("falls back to flat agents/<name>.yaml", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: key
  models: { default: { model: m } }
  profiles: { default: {} }
`,
      "config/secrets.yaml": "{}",
      "agents/tester.yaml": `
spec:
  persona: p.md
  modelProfile: default
`,
      "p.md": "p",
    });
    const settings = await loadRuntimeSettings(
      root,
      "tester",
      resolver(),
    );
    expect(settings.persona).toBe(path.join(root, "p.md"));
    expect(settings.model).toBe("m");
    expect(settings.mcp).toEqual([]);
  });

  it("captures reference-resolved secrets as redactionSecrets by provenance, incl. free-form skill config, excluding base_url/model", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: "\${ENV:LLM_BASE}"
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: "\${ENV:LLM_MODEL}" } }
  profiles: { default: {} }
skills:
  custom:
    encryption_key: "\${ENV:CIPHER}"
`,
      "config/secrets.yaml": `vaulted: "\${VAULT:secret/data#vfield}"`,
      "agents/tester.yaml": `
spec:
  persona: p.md
  modelProfile: default
`,
      "p.md": "p",
    });
    const settings = await loadRuntimeSettings(
      root,
      "tester",
      resolver(
        {
          LLM_BASE: "https://llm.example/v1",
          LLM_KEY: "sk-APIKEYVALUE",
          LLM_MODEL: "big-model-x",
          CIPHER: "CIPHER-SECRET-VALUE",
        },
        { vfield: "VAULT-SECRET-VALUE" },
      ),
    );
    const seeds = settings.redactionSecrets ?? [];
    // ENV-resolved api key, a VAULT-resolved secrets.yaml value, and a secret
    // under a FREE-FORM skill key with no secret-y name are all captured.
    expect(seeds).toContain("sk-APIKEYVALUE");
    expect(seeds).toContain("VAULT-SECRET-VALUE");
    expect(seeds).toContain("CIPHER-SECRET-VALUE");
    // The two known non-secret reference-backed values stay readable.
    expect(seeds).not.toContain("https://llm.example/v1");
    expect(seeds).not.toContain("big-model-x");
  });

  it("omits secrets that fail to resolve and loads evolution.yaml when present", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: key
  models: { default: { model: m } }
  profiles: { default: {} }
`,
      "config/secrets.yaml": `
present: literal
missing: "\${ENV:NOPE}"
`,
      "agents/elliott/agent.yaml": `
spec:
  persona: p.md
  modelProfile: default
`,
      "p.md": "p",
    });
    const settings = await loadRuntimeSettings(root, "elliott", resolver());
    expect(settings.model).toBe("m");
    expect(settings.braveApiKey).toBeUndefined();
    expect(settings.webhookSecret).toBeUndefined();
  });

  it("rejects non-mapping YAML and non-text secret values", async () => {
    const badConfig = await writeTree({
      "config/elliott.yaml": "- just a list\n",
      "config/secrets.yaml": "{}",
      "agents/elliott.yaml": "spec: { persona: p.md, modelProfile: default }\n",
    });
    await expect(loadRuntimeSettings(badConfig, "elliott", resolver()))
      .rejects.toThrow(/must contain a mapping/);

    const badSecret = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: key
  models: { default: { model: m } }
  profiles: { default: {} }
`,
      "config/secrets.yaml": "token: 123\n",
      "agents/elliott.yaml": "spec: { persona: p.md, modelProfile: default }\n",
      "p.md": "p",
    });
    await expect(loadRuntimeSettings(badSecret, "elliott", resolver()))
      .rejects.toThrow(/Secret token is not text/);
  });

  it("resolves nested ENV expressions inside the config tree", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime:
  timezone: UTC
llm:
  base_url: "\${ENV:BASE}"
  api_key: "\${ENV:KEY}"
  models:
    default:
      model: "\${ENV:MODEL}"
  profiles:
    default: {}
browser:
  daemon_url: "\${ENV:BROWSER}"
  token: "\${ENV:BROWSER_TOKEN}"
  allowed_domains: [example.com]
`,
      "config/secrets.yaml": "{}",
      "agents/elliott.yaml": "spec: { persona: p.md, modelProfile: default }\n",
      "p.md": "p",
    });
    const settings = await loadRuntimeSettings(
      root,
      "elliott",
      resolver({
        BASE: "http://llm",
        KEY: "k",
        MODEL: "m",
        BROWSER: "http://browser",
        BROWSER_TOKEN: "bt",
      }),
    );
    expect(settings.browser).toEqual({
      baseUrl: "http://browser",
      token: "bt",
      allowedDomains: ["example.com"],
    });
  });
});
