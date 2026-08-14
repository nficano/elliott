import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRuntimeSettings } from "../../../src/runtime/config";
import type { SecretResolver } from "../../../src/runtime/types";

// Secret-bearing fields must be opaque references (config enforces this), so the
// fixtures reference ${ENV:LLM_KEY} for the api_key; this default makes it
// resolvable everywhere without threading it through every call.
const DEFAULT_ENV: Readonly<Record<string, string>> = {
  LLM_KEY: "test-api-key",
};

const resolver = (
  env: Readonly<Record<string, string>> = {},
  vault: Readonly<Record<string, string>> = {},
): SecretResolver => ({
  env: (name) => env[name] ?? DEFAULT_ENV[name],
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
    app_token: "\${ENV:SLACK_APP}"
    bot_token: "\${ENV:SLACK_BOT}"
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
    dsn: "\${ENV:GLITCHTIP_DSN}"
store:
  dsn: "\${ENV:STORE_DSN}"
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
        GLITCHTIP_DSN: "https://glitchtip.example/1",
        STORE_DSN: "postgres://local/db",
        SLACK_APP: "xapp",
        SLACK_BOT: "xoxb",
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
  api_key: "\${ENV:LLM_KEY}"
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

  it("does not aggregate resolved secrets into any settings field", async () => {
    // The reporter no longer needs a secret list (it transmits no message), so
    // no `redactionSecrets`-style aggregate may exist on RuntimeSettings for a
    // skill's register() to read.
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: "\${ENV:LLM_KEY}"
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
      resolver({ LLM_KEY: "sk-APIKEYVALUE" }),
    );
    // No field on settings is an array that pools the resolved api key.
    for (const property of Object.values(settings)) {
      if (Array.isArray(property)) {
        expect(property).not.toContain("sk-APIKEYVALUE");
      }
    }
    expect("redactionSecrets" in settings).toBe(false);
  });

  const withGlitchtip = (enabled: string): Record<string, string> => ({
    "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: m } }
  profiles: { default: {} }
observability:
  glitchtip:
    enabled: ${enabled}
    dsn: "\${ENV:MISSING_GLITCHTIP_DSN}"
`,
    "config/secrets.yaml": "{}",
    "agents/tester.yaml": "spec: { persona: p.md, modelProfile: default }",
    "p.md": "p",
  });

  it("boots when glitchtip is disabled even if its dsn reference is unresolvable", async () => {
    // A turned-off feature's dsn is never used, so an unresolvable ${ENV:…}
    // reference under it must not abort boot.
    const root = await writeTree(withGlitchtip("false"));
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.glitchtip).toBeUndefined();
  });

  it("still aborts when glitchtip is ENABLED with an unresolvable dsn reference", async () => {
    // Enabling it with a dsn you cannot resolve is a real config error.
    const root = await writeTree(withGlitchtip("true"));
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow("Environment is missing MISSING_GLITCHTIP_DSN");
  });

  it("boots when `enabled` is a REFERENCE that resolves to false, unused dsn missing", async () => {
    // enabled itself is a ${ENV:…} reference; resolving it to a disabled value
    // must drop the unused dsn before its (missing) reference aborts boot.
    const root = await writeTree(withGlitchtip("\"${ENV:GLITCHTIP_ENABLED}\""));
    const settings = await loadRuntimeSettings(
      root,
      "tester",
      resolver({ GLITCHTIP_ENABLED: "false" }),
    );
    expect(settings.glitchtip).toBeUndefined();
  });

  it("aborts when `enabled` reference resolves to true and dsn is unresolvable", async () => {
    const root = await writeTree(withGlitchtip("\"${ENV:GLITCHTIP_ENABLED}\""));
    await expect(
      loadRuntimeSettings(
        root,
        "tester",
        resolver({ GLITCHTIP_ENABLED: "true" }),
      ),
    ).rejects.toThrow("Environment is missing MISSING_GLITCHTIP_DSN");
  });

  it("omits secrets that fail to resolve and loads evolution.yaml when present", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  base_url: http://llm
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: m } }
  profiles: { default: {} }
`,
      "config/secrets.yaml": `
present: "\${ENV:BRAVE}"
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
  api_key: "\${ENV:LLM_KEY}"
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

  const withLlm = (block: string): Record<string, string> => ({
    "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
${block}
  models: { default: { model: m } }
  profiles: { default: {} }
`,
    "config/secrets.yaml": "{}",
    "agents/tester.yaml": "spec: { persona: p.md, modelProfile: default }",
    "p.md": "p",
  });

  it("keeps an explicit base_url verbatim and defaults its wire to openai", async () => {
    // Every config written before providers existed points at an
    // OpenAI-compatible endpoint (LiteLLM proxy, Ollama, a vendor /v1).
    // Those must keep booting unchanged, on the OpenAI wire.
    const root = await writeTree(
      withLlm(
        "  base_url: https://proxy.internal/v1\n  api_key: '${ENV:LLM_KEY}'",
      ),
    );
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.llmBaseUrl).toBe("https://proxy.internal/v1");
    expect(settings.llmWire).toBe("openai");
  });

  it("resolves base_url and wire from provider: anthropic", async () => {
    const root = await writeTree(
      withLlm("  provider: anthropic\n  api_key: '${ENV:LLM_KEY}'"),
    );
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.llmBaseUrl).toBe("https://api.anthropic.com/v1");
    expect(settings.llmWire).toBe("anthropic");
  });

  it("resolves base_url and wire from provider: openai", async () => {
    const root = await writeTree(
      withLlm("  provider: openai\n  api_key: '${ENV:LLM_KEY}'"),
    );
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.llmBaseUrl).toBe("https://api.openai.com/v1");
    expect(settings.llmWire).toBe("openai");
  });

  it("lets an explicit base_url override the provider default, keeping its wire", async () => {
    // Pointing an Anthropic-speaking gateway at a private host is legitimate:
    // the URL is yours, the protocol is still Anthropic's.
    const root = await writeTree(
      withLlm(
        "  provider: anthropic\n  base_url: https://gateway.internal/v1\n  api_key: '${ENV:LLM_KEY}'",
      ),
    );
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.llmBaseUrl).toBe("https://gateway.internal/v1");
    expect(settings.llmWire).toBe("anthropic");
  });

  it("fails closed naming both keys when neither base_url nor provider is set", async () => {
    const root = await writeTree(withLlm("  api_key: '${ENV:LLM_KEY}'"));
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow(/llm\.base_url.*llm\.provider.*anthropic.*openai/s);
  });

  it("rejects an unknown provider by name", async () => {
    const root = await writeTree(
      withLlm("  provider: googol\n  api_key: '${ENV:LLM_KEY}'"),
    );
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow(/Unknown llm\.provider: googol/);
  });

  it("still requires api_key when a provider supplies the base_url", async () => {
    const root = await writeTree(withLlm("  provider: openai"));
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow(/llm\.api_key/);
  });

  it("reads thinking and effort from the default profile", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  provider: anthropic
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: claude-opus-5 } }
  profiles:
    default:
      thinking: adaptive
      effort: xhigh
`,
      "config/secrets.yaml": "{}",
      "agents/tester.yaml": "spec: { persona: p.md, modelProfile: default }",
      "p.md": "p",
    });
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.thinking).toBe("adaptive");
    expect(settings.effort).toBe("xhigh");
  });

  it("leaves thinking and effort unset when the profile omits them", async () => {
    const root = await writeTree(
      withLlm("  provider: anthropic\n  api_key: '${ENV:LLM_KEY}'"),
    );
    const settings = await loadRuntimeSettings(root, "tester", resolver());
    expect(settings.thinking).toBeUndefined();
    expect(settings.effort).toBeUndefined();
  });

  it("rejects an effort level the providers do not define", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  provider: anthropic
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: claude-opus-5 } }
  profiles: { default: { effort: ludicrous } }
`,
      "config/secrets.yaml": "{}",
      "agents/tester.yaml": "spec: { persona: p.md, modelProfile: default }",
      "p.md": "p",
    });
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow(/llm\.profiles\.default\.effort/);
  });

  it("rejects a thinking mode the providers do not define", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  provider: anthropic
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: claude-opus-5 } }
  profiles: { default: { thinking: sometimes } }
`,
      "config/secrets.yaml": "{}",
      "agents/tester.yaml": "spec: { persona: p.md, modelProfile: default }",
      "p.md": "p",
    });
    await expect(loadRuntimeSettings(root, "tester", resolver()))
      .rejects.toThrow(/llm\.profiles\.default\.thinking/);
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

  // An unresolvable secrets.yaml entry must NOT be fatal. A dormant or disabled
  // skill whose credential is absent is the expected steady state on a fresh
  // checkout; failing the boot for it would make the runtime unstartable until
  // every optional secret is seeded. Pinned because an earlier attempt to improve
  // the diagnosis below did exactly that.
  it("boots with an unresolvable secret a dormant skill points at", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  provider: anthropic
  api_key: "\${ENV:LLM_KEY}"
  models: { default: { model: m } }
  profiles: { default: {} }
skills:
  dormant:
    token: sleepy
`,
      "config/secrets.yaml": "sleepy: \"${ENV:NEVER_SET}\"\n",
      "agents/elliott.yaml": "spec: { persona: p.md, modelProfile: default }\n",
      "p.md": "persona",
    });
    const settings = await loadRuntimeSettings(root, "elliott", resolver());
    expect(settings.llmApiKey).toBe("test-api-key");
    // The dormant skill's credential is simply absent, not a boot failure.
    expect(settings.skillConfig?.["dormant"]).toEqual({});
  });

  // The other direction: when a REQUIRED field is the one left absent, the error
  // must name the environment key behind the pointer. "Missing configuration:
  // llm.api_key" alone blames the field the operator set correctly.
  it("names the missing environment key when a required pointer cannot resolve", async () => {
    const root = await writeTree({
      "config/elliott.yaml": `
runtime: { timezone: UTC }
llm:
  provider: anthropic
  api_key: pointed
  models: { default: { model: m } }
  profiles: { default: {} }
`,
      "config/secrets.yaml": "pointed: \"${ENV:MISSING_VENDOR_KEY}\"\n",
      "agents/elliott.yaml": "spec: { persona: p.md, modelProfile: default }\n",
      "p.md": "persona",
    });
    let message = "";
    try {
      await loadRuntimeSettings(root, "elliott", resolver());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("llm.api_key");
    expect(message).toContain("config/secrets.yaml#pointed");
    expect(message).toContain("MISSING_VENDOR_KEY");
  });
});
