import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSecretValues } from "../../src/runtime/config";

const resolver = { env: () => undefined, vault: async () => "" };

const withRoot = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "elliott-secret-values-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(root, "config", name), body);
  }
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("resolveSecretValues", () => {
  it("collects every secrets.yaml value plus the elliott.yaml api_key", async () => {
    await withRoot({
      "secrets.yaml": "brave_api_key: brave-secret\nha_token: mcp-secret\n",
      "elliott.yaml":
        "llm:\n  provider: anthropic\n  api_key: literal-key\n  models: { default: { model: m } }\n",
    }, async (root) => {
      const values = await resolveSecretValues(root, resolver);
      expect(values).toContain("brave-secret");
      expect(values).toContain("mcp-secret");
      expect(values).toContain("literal-key");
      // Non-secret config is never in the redaction set.
      expect(values).not.toContain("anthropic");
      expect(values).not.toContain("m");
    });
  });

  it("tolerates a missing secrets.yaml, returning only the api_key", async () => {
    await withRoot({
      "elliott.yaml": "llm:\n  api_key: only-key\n",
    }, async (root) => {
      expect(await resolveSecretValues(root, resolver)).toEqual(["only-key"]);
    });
  });
});
