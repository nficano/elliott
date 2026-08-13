import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRuntimeSettings,
  recordingResolver,
} from "../../src/runtime/config";
import type { SecretResolver } from "../../src/runtime/types";

const envResolver = (
  env: Readonly<Record<string, string | undefined>>,
): SecretResolver => ({
  env: (name) => env[name],
  vault: async () => "",
});

const withRoot = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "elliott-recording-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "agents"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const ELLIOTT_YAML = [
  "runtime: { timezone: UTC }",
  "llm:",
  "  provider: anthropic",
  "  api_key: \"${ENV:LLM_KEY}\"",
  "  models: { default: { model: test-model } }",
  "  profiles: { default: {} }",
  "observability: { glitchtip: { enabled: true } }",
  "",
].join("\n");

const AGENT_YAML =
  "spec: { persona: p.md, modelProfile: default, mcp: [ { id: x, url: https://x, transport: sse, authorizationSecret: mcp_token } ] }\n";

describe("recordingResolver", () => {
  it("records every resolved secret a settings load touches, by construction", async () => {
    await withRoot({
      "config/elliott.yaml": ELLIOTT_YAML,
      "config/secrets.yaml":
        "brave_api_key: \"${ENV:BRAVE}\"\nmcp_token: \"${ENV:MCP}\"\n",
      "agents/elliott.yaml": AGENT_YAML,
      "p.md": "persona",
    }, async (root) => {
      const env = {
        LLM_KEY: "llm-secret",
        BRAVE: "brave-secret",
        MCP: "mcp-secret",
        ELLIOTT_GLITCHTIP_DSN: "https://dsn-secret@errors.example/1",
      };
      const { resolver, recorded } = recordingResolver(envResolver(env));
      await loadRuntimeSettings(root, "elliott", resolver);
      const secrets = recorded();
      // The LLM key, a nested skill secret, an MCP authorization resolved from
      // secrets.yaml, and the GlitchTip DSN (read through the resolver) are all
      // captured — none of them named in any list the doctor maintains.
      expect(secrets).toContain("llm-secret");
      expect(secrets).toContain("brave-secret");
      expect(secrets).toContain("mcp-secret");
      expect(secrets).toContain("https://dsn-secret@errors.example/1");
    });
  });

  it("returns undefined for an unset env var and records nothing for it", () => {
    const { resolver, recorded } = recordingResolver(envResolver({}));
    expect(resolver.env("NOPE")).toBeUndefined();
    expect(recorded()).toEqual([]);
  });
});
