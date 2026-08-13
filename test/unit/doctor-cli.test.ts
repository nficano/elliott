import { afterEach, describe, expect, it } from "bun:test";
import { doctorEnvOverlay, runDoctorCli } from "../../src/runtime/doctor/cli";

describe("doctorEnvOverlay", () => {
  it("passes an explicit ELLIOTT_LLM_* trio through the overlay", () => {
    const { overlay, modelDefaulted } = doctorEnvOverlay({
      ELLIOTT_LLM_PROVIDER: "openai",
      ELLIOTT_LLM_API_KEY: "sk-explicit",
      ELLIOTT_LLM_MODEL: "gpt-4o",
    });
    expect(overlay).toEqual({
      ELLIOTT_LLM_PROVIDER: "openai",
      ELLIOTT_LLM_API_KEY: "sk-explicit",
      ELLIOTT_LLM_MODEL: "gpt-4o",
    });
    expect(modelDefaulted).toBe(false);
  });

  it("infers anthropic from a lone ANTHROPIC_API_KEY with a default model", () => {
    const { overlay, modelDefaulted } = doctorEnvOverlay({
      ANTHROPIC_API_KEY: "sk-ant",
    });
    expect(overlay["ELLIOTT_LLM_PROVIDER"]).toBe("anthropic");
    expect(overlay["ELLIOTT_LLM_API_KEY"]).toBe("sk-ant");
    expect((overlay["ELLIOTT_LLM_MODEL"] ?? "").length).toBeGreaterThan(0);
    expect(modelDefaulted).toBe(true);
  });

  it("infers openai from a lone OPENAI_API_KEY", () => {
    const { overlay } = doctorEnvOverlay({ OPENAI_API_KEY: "sk-oai" });
    expect(overlay["ELLIOTT_LLM_PROVIDER"]).toBe("openai");
    expect(overlay["ELLIOTT_LLM_API_KEY"]).toBe("sk-oai");
  });

  it("honors an explicit model over the default when only a vendor key is set", () => {
    const { overlay, modelDefaulted } = doctorEnvOverlay({
      ANTHROPIC_API_KEY: "sk-ant",
      ELLIOTT_LLM_MODEL: "claude-opus-4-8",
    });
    expect(overlay["ELLIOTT_LLM_MODEL"]).toBe("claude-opus-4-8");
    expect(modelDefaulted).toBe(false);
  });

  it("leaves the overlay empty when a named provider has no key anywhere", () => {
    const { overlay } = doctorEnvOverlay({ ELLIOTT_LLM_PROVIDER: "anthropic" });
    expect(overlay).toEqual({});
  });

  it("leaves the overlay empty when nothing is set", () => {
    expect(doctorEnvOverlay({}).overlay).toEqual({});
  });
});

describe("runDoctorCli", () => {
  const savedExitCode = process.exitCode ?? 0;

  afterEach(() => {
    // Reset to a concrete number: the doctor command sets process.exitCode on
    // failure, and a leaked nonzero code would fail the whole `bun test` run.
    process.exitCode = savedExitCode;
  });

  it("declines argv that is not the doctor command", async () => {
    const handled = await runDoctorCli(["new", "skill", "x"], "/repo", {});
    expect(handled).toBe(false);
  });

  it("handles the doctor command with a clean error when config is missing", async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: unknown) => errors.push(String(message));
    try {
      // Real repo root so settings loading reaches the LLM config boundary,
      // which names the missing variable; an empty env supplies no credential.
      const handled = await runDoctorCli(["doctor"], ".", {});
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(errors.join("\n")).toContain("ANTHROPIC_API_KEY");
    } finally {
      console.error = original;
    }
  });
});
