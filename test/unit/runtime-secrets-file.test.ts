import { describe, expect, it } from "bun:test";
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

  it("fails the boot loudly when the file cannot be read", () => {
    expect(() =>
      readMountedSecrets({ ELLIOTT_SECRETS_FILE: "/run/missing.json" }, () => {
        throw new Error("ENOENT");
      })
    ).toThrow(/ELLIOTT_SECRETS_FILE \/run\/missing\.json is unreadable/);
  });

  it("rejects malformed JSON instead of booting secretless", () => {
    expect(() =>
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "api_key=k1",
      )
    ).toThrow(/is unreadable/);
    expect(() =>
      readMountedSecrets(
        { ELLIOTT_SECRETS_FILE: "/run/secrets.json" },
        () => "[\"k1\"]",
      )
    ).toThrow(/must hold a JSON object/);
  });
});
