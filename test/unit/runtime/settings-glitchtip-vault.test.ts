import { describe, expect, it } from "bun:test";
import { optionalGlitchTip } from "../../../src/runtime/settings-observability";
import { optionalVault } from "../../../src/runtime/settings-tools";

const DEFAULT_DSN = "http://elliott@127.0.0.1:9080/1";

describe("optionalGlitchTip (default-on error reporting)", () => {
  it("is on with the bundled collector DSN when no config is present", () => {
    expect(optionalGlitchTip({})).toEqual({ glitchtip: { dsn: DEFAULT_DSN } });
  });

  it("is on with the bundled collector DSN when enabled but no dsn is set", () => {
    expect(
      optionalGlitchTip({ observability: { glitchtip: { enabled: true } } }),
    )
      .toEqual({ glitchtip: { dsn: DEFAULT_DSN } });
  });

  it("uses an operator-supplied DSN verbatim", () => {
    expect(
      optionalGlitchTip({
        observability: { glitchtip: { dsn: "https://k@sentry.example/9" } },
      }),
    ).toEqual({ glitchtip: { dsn: "https://k@sentry.example/9" } });
  });

  it("is fully off only when explicitly disabled", () => {
    expect(
      optionalGlitchTip({ observability: { glitchtip: { enabled: false } } }),
    ).toEqual({});
  });

  it("treats falsy string values for enabled as disabled (no fail-open)", () => {
    for (const flag of ["false", "False", " off ", "no", "0"]) {
      expect(
        optionalGlitchTip({ observability: { glitchtip: { enabled: flag } } }),
      ).toEqual({});
    }
  });

  it("treats numeric 0 for enabled as disabled (YAML `enabled: 0`)", () => {
    expect(
      optionalGlitchTip({ observability: { glitchtip: { enabled: 0 } } }),
    ).toEqual({});
  });

  it("stays on for a truthy or unrecognized enabled value", () => {
    expect(
      optionalGlitchTip({ observability: { glitchtip: { enabled: "true" } } }),
    ).toEqual({ glitchtip: { dsn: DEFAULT_DSN } });
  });

  it("uses the ELLIOTT_GLITCHTIP_DSN env override when no config dsn is set", () => {
    expect(optionalGlitchTip({}, "https://env@sentry.example/7")).toEqual({
      glitchtip: { dsn: "https://env@sentry.example/7" },
    });
  });

  it("prefers an explicit config dsn over the env override", () => {
    expect(
      optionalGlitchTip(
        {
          observability: { glitchtip: { dsn: "https://cfg@sentry.example/1" } },
        },
        "https://env@sentry.example/7",
      ),
    ).toEqual({ glitchtip: { dsn: "https://cfg@sentry.example/1" } });
  });

  it("falls back to the collector when the env override is empty", () => {
    expect(optionalGlitchTip({}, "")).toEqual({
      glitchtip: { dsn: DEFAULT_DSN },
    });
  });

  it("stays off when disabled even if an env override is present", () => {
    expect(
      optionalGlitchTip(
        { observability: { glitchtip: { enabled: false } } },
        "https://env@sentry.example/7",
      ),
    ).toEqual({});
  });
});

describe("optionalVault (default-off, fail-closed)", () => {
  const enabled = (
    extra: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> => ({
    tools: { vault: { enabled: true, ...extra } },
  });

  it("registers nothing when absent or disabled", () => {
    expect(optionalVault({}, {})).toEqual({});
    expect(optionalVault({ tools: { vault: { enabled: false } } }, {})).toEqual(
      {},
    );
  });

  it("fails closed without a token", () => {
    expect(
      optionalVault(enabled({ address: "https://v:8200", paths: ["a"] }), {}),
    ).toEqual({});
  });

  it("fails closed without an address", () => {
    expect(
      optionalVault(enabled({ paths: ["a"] }), { vault_token: "t" }),
    ).toEqual({});
  });

  it("fails closed with an empty path allowlist", () => {
    expect(
      optionalVault(enabled({ address: "https://v:8200", paths: [] }), {
        vault_token: "t",
      }),
    ).toEqual({});
  });

  it("resolves when the flag, address, token, and allowlist are all present", () => {
    expect(
      optionalVault(
        enabled({ address: "https://v:8200", paths: ["secret/data/app"] }),
        { vault_token: "hvs.tok" },
      ),
    ).toEqual({
      vault: {
        address: "https://v:8200",
        token: "hvs.tok",
        paths: ["secret/data/app"],
      },
    });
  });
});
