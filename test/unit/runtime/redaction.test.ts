import { describe, expect, it } from "bun:test";
import {
  collectSecretStrings,
  makeRedactor,
  redactPatterns,
} from "../../../src/runtime/redaction";

describe("redactPatterns (shape-based, no configuration)", () => {
  it("strips HashiCorp Vault tokens (service/batch/recovery)", () => {
    const out = redactPatterns(
      "auth failed with hvs.CAESABC-123 and hvb.deadBEEF_9 and hvr.xyz.42",
    );
    expect(out).not.toContain("hvs.CAESABC-123");
    expect(out).not.toContain("hvb.deadBEEF_9");
    expect(out).not.toContain("hvr.xyz.42");
  });

  it("strips common API-key shapes (sk-/xox/gh/AKIA) even when un-seeded", () => {
    const out = redactPatterns(
      "keys: sk-live-ABCDEFGH12345678 xoxb-111-222-abcdef ghp_ABCDEFGHIJKLMNOPQRST "
        + "AKIAIOSFODNN7EXAMPLE done",
    );
    expect(out).not.toContain("sk-live-ABCDEFGH12345678");
    expect(out).not.toContain("xoxb-111-222-abcdef");
    expect(out).not.toContain("ghp_ABCDEFGHIJKLMNOPQRST");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("keys:");
    expect(out).toContain("done");
  });

  it("strips URL userinfo (a DSN public key / user:pass@host)", () => {
    const out = redactPatterns(
      "posting to https://leakykey@sentry.example/1 failed",
    );
    expect(out).not.toContain("leakykey");
    expect(out).not.toContain("sentry.example");
    expect(out).toContain("posting to");
    expect(out).toContain("failed");
  });

  it("leaves ordinary error text untouched", () => {
    for (
      const clean of ["upstream 500", "no host", "boom", "connection reset"]
    ) {
      expect(redactPatterns(clean)).toBe(clean);
    }
  });

  it("does not eat ordinary prose that merely contains 's.'", () => {
    // The legacy-token pattern is length-gated, so this is not redacted.
    expect(redactPatterns("see items.list for details")).toBe(
      "see items.list for details",
    );
  });
});

describe("makeRedactor (exact secret values + shapes)", () => {
  it("strips the exact configured DSN, Vault token, and Vault paths", () => {
    const redact = makeRedactor([
      "http://elliott@127.0.0.1:9080/1",
      "hvs.CONFIGUREDTOKEN",
      "secret/data/private",
    ]);
    const out = redact(
      "Vault read of secret/data/private with hvs.CONFIGUREDTOKEN "
        + "against http://elliott@127.0.0.1:9080/1 failed",
    );
    expect(out).not.toContain("secret/data/private");
    expect(out).not.toContain("hvs.CONFIGUREDTOKEN");
    expect(out).not.toContain("127.0.0.1:9080");
    expect(out).toContain("Vault read of");
  });

  it("redacts short secrets too — a short secret is still a secret", () => {
    const redact = makeRedactor(["abc"]);
    expect(redact("password abc rejected")).not.toContain("abc");
  });

  it("drops only empty/whitespace literals (they would shred every message)", () => {
    const redact = makeRedactor(["", " ".repeat(3)]);
    expect(redact("a stable readable message")).toBe(
      "a stable readable message",
    );
  });

  it("still applies shape patterns for secrets it was not seeded with", () => {
    const redact = makeRedactor(["secret/data/known"]);
    // hvs.* is caught by pattern even though it was never seeded.
    expect(redact("token hvs.UNSEEDEDvalue123")).not.toContain(
      "hvs.UNSEEDEDvalue123",
    );
  });
});

describe("collectSecretStrings (seed the redactor from settings)", () => {
  const settings = {
    environment: "prod",
    llmBaseUrl: "https://api.example.com/v1",
    llmApiKey: "sk-live-SEEDED-KEY-VALUE",
    model: "provider/big-model",
    slack: {
      botToken: "xoxb-1-2-slackbot",
      ownerId: "U123",
      defaultChannel: "C1",
    },
    ssh: {
      user: "elliott",
      hosts: ["a.example"],
      privateKey: "SSH-PRIVATE-KEY-BODY",
    },
    webhookSecret: "whsec_SEEDEDVALUE",
    postgresDsn: "postgres://u:PGPASSWORD@db/app",
    vault: {
      address: "https://v:8200",
      token: "hvs.VTOKEN",
      paths: ["secret/data/x"],
    },
    mcp: [{
      id: "m",
      url: "https://m",
      transport: "sse",
      authorization: "Bearer MCPTOK",
    }],
  };

  it("collects every secret-named string value", () => {
    const found = collectSecretStrings(settings);
    expect(found).toContain("sk-live-SEEDED-KEY-VALUE");
    expect(found).toContain("xoxb-1-2-slackbot");
    expect(found).toContain("SSH-PRIVATE-KEY-BODY");
    expect(found).toContain("whsec_SEEDEDVALUE");
    expect(found).toContain("postgres://u:PGPASSWORD@db/app");
    expect(found).toContain("hvs.VTOKEN");
    expect(found).toContain("Bearer MCPTOK");
  });

  it("matches snake_case / kebab-case keys and arrays under secret keys", () => {
    // Under a NON-free-form container, a snake_case `api_key`, a kebab-case
    // `api-key`, an array of keys, and a nested credentials object must all be
    // collected, while a plainly-named non-secret sibling is not.
    const found = collectSecretStrings({
      gateway: {
        api_key: "SNAKE-LEAK",
        "api-key": "KEBAB-LEAK",
        api_keys: ["ARRAY-LEAK-1", "ARRAY-LEAK-2"],
        credentials: { secret_value: "NESTED-LEAK" },
        endpoint: "https://api.example.com",
      },
    });
    expect(found).toContain("SNAKE-LEAK");
    expect(found).toContain("KEBAB-LEAK");
    expect(found).toContain("ARRAY-LEAK-1");
    expect(found).toContain("ARRAY-LEAK-2");
    expect(found).toContain("NESTED-LEAK");
    // A non-secret key outside any secret subtree is not collected.
    expect(found).not.toContain("https://api.example.com");
  });

  it("treats free-form skillConfig/skills subtrees as wholesale sensitive", () => {
    // The framework has no schema for agent-skill config, so a secret can sit
    // under ANY key name (encryption_key, cipher, …). Every string there is
    // collected — name inference can't be trusted where names are arbitrary.
    const found = collectSecretStrings({
      skillConfig: {
        custom: { encryption_key: "FREEFORM-SECRET", nested: ["A", "B"] },
      },
      skills: { other: { cipher_seed: "SEED-SECRET" } },
    });
    expect(found).toContain("FREEFORM-SECRET");
    expect(found).toContain("SEED-SECRET");
    expect(found).toContain("A");
    expect(found).toContain("B");
  });

  it("does not collect non-secret fields (hostnames, model, allowlists)", () => {
    const found = collectSecretStrings(settings);
    expect(found).not.toContain("https://api.example.com/v1");
    expect(found).not.toContain("provider/big-model");
    expect(found).not.toContain("a.example");
    expect(found).not.toContain("elliott");
    // Vault paths are collected explicitly by the caller, not here (key is "paths").
    expect(found).not.toContain("secret/data/x");
  });

  it("seeds a redactor that strips every configured secret from a message", () => {
    const redact = makeRedactor(collectSecretStrings(settings));
    const out = redact(
      "boot failed: provider rejected sk-live-SEEDED-KEY-VALUE; "
        + "model provider/big-model at https://api.example.com/v1",
    );
    expect(out).not.toContain("sk-live-SEEDED-KEY-VALUE");
    // Non-secret context (model, base URL) survives for debuggability.
    expect(out).toContain("provider/big-model");
    expect(out).toContain("https://api.example.com/v1");
  });
});
