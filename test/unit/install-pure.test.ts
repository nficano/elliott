import { describe, expect, it } from "bun:test";
import { validateSkillManifest } from "../../src/install/fetch";
import { InstallError } from "../../src/install/types";

const NAME = "traefik";
const VERSION = "1.2.3";

const validManifest = (): Record<string, unknown> => ({
  apiVersion: "elliott/v1",
  metadata: { name: NAME, version: VERSION },
  spec: { document: "SKILL.md" },
});

describe("validateSkillManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(() => validateSkillManifest(validManifest(), NAME, VERSION))
      .not.toThrow();
  });

  it("accepts every declared document kind", () => {
    for (
      const document of [
        "SKILL.md",
        "TOOL.md",
        "GATEWAY.md",
        "MCP.md",
        "EXTENSION.md",
        "SCHEDULER.md",
        "EVALUATOR.md",
      ]
    ) {
      const manifest = { ...validManifest(), spec: { document } };
      expect(() => validateSkillManifest(manifest, NAME, VERSION)).not
        .toThrow();
    }
  });

  it("rejects a non-object manifest", () => {
    expect(() => validateSkillManifest(null, NAME, VERSION)).toThrow(
      InstallError,
    );
    expect(() => validateSkillManifest("nope", NAME, VERSION)).toThrow(
      `${NAME}: invalid manifest`,
    );
    expect(() => validateSkillManifest([1, 2], NAME, VERSION)).toThrow(
      `${NAME}: invalid manifest`,
    );
  });

  it("rejects an unsupported apiVersion", () => {
    const manifest = { ...validManifest(), apiVersion: "elliott/v2" };
    expect(() => validateSkillManifest(manifest, NAME, VERSION)).toThrow(
      `${NAME}: unsupported apiVersion`,
    );
  });

  it("rejects non-object metadata or spec", () => {
    expect(() =>
      validateSkillManifest(
        { ...validManifest(), metadata: "x" },
        NAME,
        VERSION,
      )
    ).toThrow(`${NAME}: invalid manifest metadata/spec`);
    expect(() =>
      validateSkillManifest({ ...validManifest(), spec: 3 }, NAME, VERSION)
    ).toThrow(`${NAME}: invalid manifest metadata/spec`);
  });

  it("rejects a name that differs from the directory", () => {
    const manifest = {
      ...validManifest(),
      metadata: { name: "other", version: VERSION },
    };
    expect(() => validateSkillManifest(manifest, NAME, VERSION)).toThrow(
      `${NAME}: manifest name "other" != directory`,
    );
  });

  it("rejects a version that differs from the tag", () => {
    const manifest = {
      ...validManifest(),
      metadata: { name: NAME, version: "9.9.9" },
    };
    expect(() => validateSkillManifest(manifest, NAME, VERSION)).toThrow(
      `${NAME}: manifest version "9.9.9" != tag ${VERSION}`,
    );
  });

  it("rejects a non-string or unknown spec.document", () => {
    expect(() =>
      validateSkillManifest(
        { ...validManifest(), spec: { document: 42 } },
        NAME,
        VERSION,
      )
    ).toThrow(`${NAME}: invalid spec.document`);
    expect(() =>
      validateSkillManifest(
        { ...validManifest(), spec: { document: "README.md" } },
        NAME,
        VERSION,
      )
    ).toThrow(`${NAME}: invalid spec.document`);
  });
});
