import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRuntimeSettings } from "../../src/runtime/config";
import type { SecretResolver } from "../../src/runtime/types";

// G27 — secrets are opaque references, enforced at the config boundary. The
// doctrine (CLAUDE.md: "Secrets are opaque references … resolved at the config
// boundary") is only an invariant if a literal credential in a secret-bearing
// field is a load-time error. This gate is the executable statement of that:
// every declared secret field must hold a ${ENV:…} or ${VAULT:…} reference, so
// no credential can enter settings without passing through SecretResolver —
// which is what makes the resolved secret set complete by construction.

const resolver = (
  env: Readonly<Record<string, string>> = {},
): SecretResolver => ({
  env: (name) => env[name],
  vault: async () => "vault-value",
});

const AGENT = "spec: { persona: p.md, modelProfile: default }\n";

const withConfig = async (
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> => {
  const root = mkdtempSync(path.join(tmpdir(), "elliott-g27-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "agents"), { recursive: true });
  writeFileSync(path.join(root, "agents", "elliott.yaml"), AGENT);
  writeFileSync(path.join(root, "p.md"), "persona");
  writeFileSync(path.join(root, "config", "secrets.yaml"), "{}\n");
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(root, "config", name), body);
  }
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const llmConfig = (extra: string): string =>
  "runtime: { timezone: UTC }\n"
  + "llm:\n"
  + "  provider: anthropic\n"
  + "  api_key: \"${ENV:LLM_KEY}\"\n"
  + "  models: { default: { model: m } }\n"
  + "  profiles: { default: {} }\n"
  + extra;

describe("G27 — secret-bearing config fields reject literal credentials", () => {
  it("rejects a literal in llm.api_key, naming the field and the reference forms", async () => {
    await withConfig({
      "elliott.yaml":
        "runtime: { timezone: UTC }\nllm:\n  provider: anthropic\n  api_key: sk-literal-key\n  models: { default: { model: m } }\n  profiles: { default: {} }\n",
    }, async (root) => {
      let message: string;
      try {
        await loadRuntimeSettings(root, "elliott", resolver());
        throw new Error("expected a literal api_key to be rejected");
      } catch (error_) {
        message = error_ instanceof Error ? error_.message : String(error_);
      }
      expect(message).toContain("llm.api_key");
      expect(message).toContain("${ENV:VAR}");
      // The offending credential is never echoed back.
      expect(message).not.toContain("sk-literal-key");
    });
  });

  it("rejects a literal in observability.glitchtip.dsn and store.dsn", async () => {
    for (
      const extra of [
        "observability: { glitchtip: { dsn: https://k@sentry.example/1 } }\n",
        "store: { dsn: postgres://user:pw@host/db }\n",
      ]
    ) {
      await withConfig({ "elliott.yaml": llmConfig(extra) }, async (root) => {
        await expect(
          loadRuntimeSettings(root, "elliott", resolver({ LLM_KEY: "k" })),
        )
          .rejects.toThrow(/must be an opaque reference/);
      });
    }
  });

  // The schema must cover EVERY config value read straight into settings as a
  // credential, not just the LLM/observability/store trio. A skill's own
  // secret-bearing config field (here the Slack tokens and the browser token) is a
  // credential too; a literal there must fail the same way, or it enters settings
  // unrecorded and a skill error can print it. This pins the completed set so an
  // omission is a gate failure, not a future finding.
  it("rejects a literal in a skill's secret-bearing config field", async () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [
        "channels.slack.app_token",
        "channels:\n  slack:\n    enabled: true\n    app_token: xapp-literal\n",
        "xapp-literal",
      ],
      [
        "channels.slack.bot_token",
        "channels:\n  slack:\n    enabled: true\n"
        + "    app_token: \"${ENV:SA}\"\n    bot_token: xoxb-literal\n",
        "xoxb-literal",
      ],
      [
        "channels.slack.user_token",
        "channels:\n  slack:\n    enabled: true\n"
        + "    app_token: \"${ENV:SA}\"\n    bot_token: \"${ENV:SB}\"\n"
        + "    user_token: xoxp-literal\n",
        "xoxp-literal",
      ],
      [
        "browser.token",
        "browser:\n  token: browser-literal\n",
        "browser-literal",
      ],
    ];
    for (const [field, extra, literal] of cases) {
      await withConfig({ "elliott.yaml": llmConfig(extra) }, async (root) => {
        let message: string;
        try {
          await loadRuntimeSettings(
            root,
            "elliott",
            resolver({ LLM_KEY: "k", SA: "a", SB: "b" }),
          );
          throw new Error(`expected a literal ${field} to be rejected`);
        } catch (error_) {
          message = error_ instanceof Error ? error_.message : String(error_);
        }
        expect(message).toContain(field);
        expect(message).toContain("opaque reference");
        expect(message).not.toContain(literal);
      });
    }
  });

  // The decisive case: a credential field owned by an agent-local skill schema,
  // under the `skills.*` passthrough, at a path no framework list could name. The
  // role predicate (the key's final word) still catches it.
  it("rejects a literal in an arbitrary skills.* credential field", async () => {
    await withConfig({
      "elliott.yaml": llmConfig(
        "skills:\n  local:\n    token: literal-agent-secret\n",
      ),
    }, async (root) => {
      let message: string;
      try {
        await loadRuntimeSettings(root, "elliott", resolver({ LLM_KEY: "k" }));
        throw new Error("expected a literal skills.local.token to be rejected");
      } catch (error_) {
        message = error_ instanceof Error ? error_.message : String(error_);
      }
      expect(message).toContain("skills.local.token");
      expect(message).toContain("opaque reference");
      expect(message).not.toContain("literal-agent-secret");
    });
  });

  // The indirection pattern: a secret-named field whose value is the NAME of a
  // config/secrets.yaml entry is accepted (the credential lives in secrets.yaml,
  // enforced there). Recognised structurally — value is a declared secrets key —
  // so google `refresh_token_secret`, litellm `secret`, and any future pointer
  // are covered without a hand-list of pointer field names.
  it("accepts a secret-named field that names a config/secrets.yaml entry", async () => {
    await withConfig({
      "elliott.yaml": llmConfig(
        "skills:\n  local:\n    account_secret: pointed\n",
      ),
      "secrets.yaml": "pointed: \"${ENV:P}\"\n",
    }, async (root) => {
      const settings = await loadRuntimeSettings(
        root,
        "elliott",
        resolver({ LLM_KEY: "k", P: "v" }),
      );
      expect(settings.skillConfig?.["local"]).toEqual({
        account_secret: "pointed",
      });
    });
  });

  it("rejects a literal entry in config/secrets.yaml", async () => {
    await withConfig({
      "elliott.yaml": llmConfig(""),
      "secrets.yaml": "brave_api_key: literal-secret\n",
    }, async (root) => {
      await expect(
        loadRuntimeSettings(root, "elliott", resolver({ LLM_KEY: "k" })),
      )
        .rejects.toThrow(
          /config\/secrets\.yaml#brave_api_key.*opaque reference/s,
        );
    });
  });

  it("accepts references and resolves them", async () => {
    await withConfig({
      "elliott.yaml":
        "runtime: { timezone: UTC }\nllm:\n  provider: anthropic\n  api_key: \"${ENV:LLM_KEY}\"\n  models: { default: { model: m } }\n  profiles: { default: {} }\nstore: { dsn: \"${VAULT:db/main#dsn}\" }\n",
    }, async (root) => {
      const settings = await loadRuntimeSettings(
        root,
        "elliott",
        resolver({ LLM_KEY: "k" }),
      );
      expect(settings.llmApiKey).toBe("k");
      expect(settings.postgresDsn).toBe("vault-value");
    });
  });
});
