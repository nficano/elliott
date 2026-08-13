import { describe, expect, it } from "bun:test";
import { secretValuesOf } from "../../src/runtime/doctor/secrets";

describe("secretValuesOf", () => {
  it("collects values under secret-named keys and leaves non-secret config alone", () => {
    const settings = {
      environment: "prod",
      model: "claude-haiku",
      llmBaseUrl: "https://api.anthropic.com/v1",
      llmApiKey: "llm-key",
      braveApiKey: "brave-key",
      postgresDsn: "postgres://user:pw@host/db",
    };
    const secrets = secretValuesOf(settings);
    expect(secrets).toContain("llm-key");
    expect(secrets).toContain("brave-key");
    expect(secrets).toContain("postgres://user:pw@host/db");
    expect(secrets).not.toContain("prod");
    expect(secrets).not.toContain("claude-haiku");
    expect(secrets).not.toContain("https://api.anthropic.com/v1");
  });

  it("recurses into nested settings objects and arrays", () => {
    const settings = {
      slack: { botToken: "bot-token", ownerId: "U1", defaultChannel: "C1" },
      smtp: { host: "h", username: "u", password: "smtp-pw", from: "f" },
      ssh: { user: "u", hosts: ["a"], privateKey: "priv-key" },
      google: { accounts: [{ name: "n", clientSecret: "client-secret" }] },
    };
    const secrets = secretValuesOf(settings);
    expect(secrets).toContain("bot-token");
    expect(secrets).toContain("smtp-pw");
    expect(secrets).toContain("priv-key");
    expect(secrets).toContain("client-secret");
    expect(secrets).not.toContain("U1");
    expect(secrets).not.toContain("h");
  });

  it("does not match the bare word key (e.g. keywords) or empty values", () => {
    const settings = {
      newsBrief: { keywords: ["key", "token"] },
      llmApiKey: "",
    };
    // "keywords" is not a secret key; its array values are not collected.
    expect(secretValuesOf(settings)).toEqual([]);
  });

  it("treats an env overlay the same way — only the api-key value is secret", () => {
    const overlay = {
      ELLIOTT_LLM_PROVIDER: "anthropic",
      ELLIOTT_LLM_API_KEY: "sk-secret",
      ELLIOTT_LLM_MODEL: "model-x",
    };
    expect(secretValuesOf(overlay)).toEqual(["sk-secret"]);
  });
});
