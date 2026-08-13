import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMountedSecrets } from "../../src/runtime/config";

// ELLIOTT_SECRETS_FILE feeds secrets into the config boundary through a
// mounted file instead of the process environment, so nothing sensitive is
// visible to docker inspect or the in-container terminal tool's `env`.

describe("readMountedSecrets", () => {
  it("is a no-op when the variable is unset or empty", () => {
    expect(readMountedSecrets({})).toEqual({});
    expect(readMountedSecrets({ ELLIOTT_SECRETS_FILE: "" })).toEqual({});
  });

  it("returns the string entries of the mounted JSON object", () => {
    const secrets = readMountedSecrets(
      { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
      () => JSON.stringify({ api_key: "k1", count: 3, nested: { a: 1 } }),
    );
    expect(secrets).toEqual({ api_key: "k1" });
  });

  it("distinguishes a file that cannot be read from invalid JSON", () => {
    // A read failure (missing, permission-denied) is a different problem from a
    // file that was read but held invalid JSON, and names itself accordingly.
    expect(() =>
      readMountedSecrets({ ELLIOTT_SECRETS_FILE: "/run/missing.json" }, () => {
        throw new Error("ENOENT");
      })
    ).toThrow(/ELLIOTT_SECRETS_FILE \/run\/missing\.json could not be read/);
  });

  it("rejects malformed JSON instead of booting secretless", () => {
    expect(() =>
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "api_key=k1",
      )
    ).toThrow(/is not valid JSON/);
    expect(() =>
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "[\"k1\"]",
      )
    ).toThrow(/must hold a JSON object/);
  });

  it("never echoes the file's bytes in a parse error", () => {
    // The file holds secrets; a parse error must not quote its content.
    expect(() =>
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "sk-super-secret-token-not-json",
      )
    ).toThrow(/is not valid JSON/);
    try {
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "sk-super-secret-token-not-json",
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("sk-super-secret");
    }
  });
});

describe("transmitted deployment telemetry (environment/release)", () => {
  // environment + release are the only config-sourced values that ride in a
  // transmitted GlitchTip envelope, so they must be read from the AMBIENT process
  // env, never from the secrets-file overlay (which holds Elliott-resolved
  // secrets). A subprocess is required because config.ts captures the env at
  // import; here the secrets file carries ELLIOTT_ENV/ELLIOTT_RELEASE and they
  // must NOT surface in settings.environment/release.
  it("never sources ELLIOTT_ENV/ELLIOTT_RELEASE from the secrets file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "elliott-telemetry-"));
    mkdirSync(path.join(root, "config"));
    mkdirSync(path.join(root, "agents"));
    writeFileSync(
      path.join(root, "config/elliott.yaml"),
      [
        "runtime: { timezone: UTC }",
        "llm:",
        "  base_url: \"${ENV:ELLIOTT_LLM_BASE_URL}\"",
        "  api_key: \"${ENV:ELLIOTT_LLM_API_KEY}\"",
        "  models: { default: { model: \"${ENV:ELLIOTT_LLM_MODEL}\" } }",
        "  profiles: { default: {} }",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(root, "config/secrets.yaml"), "{}\n");
    writeFileSync(
      path.join(root, "agents/tester.yaml"),
      "spec: { persona: p.md, modelProfile: default }\n",
    );
    writeFileSync(path.join(root, "p.md"), "persona");
    const secretsFile = path.join(root, "secrets.json");
    writeFileSync(
      secretsFile,
      JSON.stringify({
        ELLIOTT_LLM_BASE_URL: "http://llm",
        ELLIOTT_LLM_API_KEY: "k",
        ELLIOTT_LLM_MODEL: "m",
        ELLIOTT_ENV: "hvs.SECRET_ENV",
        ELLIOTT_RELEASE: "hvs.SECRET_RELEASE",
      }),
    );
    const configModule = path.resolve(
      import.meta.dir,
      "../../src/runtime/config.ts",
    );
    const script =
      `const { loadRuntimeSettings } = await import(${
        JSON.stringify(configModule)
      });`
      + `const s = await loadRuntimeSettings(${
        JSON.stringify(root)
      }, "tester");`
      + `process.stdout.write(JSON.stringify({ environment: s.environment, release: s.release }));`;
    const proc = Bun.spawnSync(["bun", "-e", script], {
      // Only the secrets file is provided; ELLIOTT_ENV/ELLIOTT_RELEASE are NOT in
      // the ambient env, so a correct build falls back to the defaults.
      env: {
        ELLIOTT_SECRETS_FILE: secretsFile,
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
      },
    });
    expect(proc.exitCode).toBe(0);
    const out: { environment: string; release: string; } = JSON.parse(
      proc.stdout.toString(),
    );
    expect(out.environment).toBe("prod");
    expect(out.release).toBe("dev");
    expect(JSON.stringify(out)).not.toContain("hvs.");
  });
});
