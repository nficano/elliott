import { describe, expect, it } from "bun:test";
import { probeLlm } from "../../src/runtime/doctor/probe";
import type {
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeModelCompleter,
  RuntimeSettings,
} from "../../src/runtime/types";

const settings = {
  llmWire: "anthropic",
  llmBaseUrl: "https://api.anthropic.com/v1",
  model: "claude-haiku-4-5-20251001",
} as unknown as RuntimeSettings;

const completerReturning = (
  result: ModelTurnResult,
): RuntimeModelCompleter => ({
  complete: async () => result,
});

describe("probeLlm", () => {
  it("reports ok with a bounded reply on a successful completion", async () => {
    let received: ModelTurnRequest | undefined;
    const probe = await probeLlm(settings, () => ({
      complete: async (request) => {
        received = request;
        return { text: "ready", toolCalls: [] };
      },
    }), []);
    expect(probe.ok).toBe(true);
    expect(probe.reply).toBe("ready");
    expect(probe.wire).toBe("anthropic");
    expect(probe.model).toBe("claude-haiku-4-5-20251001");
    expect(received?.allowTools).toBe(false);
    expect(received?.tools).toEqual([]);
  });

  it("reports a clean message, not a stack trace, on failure", async () => {
    const probe = await probeLlm(settings, () => ({
      complete: async () => {
        throw new Error("anthropic 401: invalid x-api-key");
      },
    }), []);
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("anthropic 401: invalid x-api-key");
    expect(probe.reply).toBeUndefined();
  });

  it("scrubs a resolved secret the endpoint echoes back", async () => {
    const probe = await probeLlm(settings, () => ({
      complete: async () => {
        throw new Error("401: echoed Bearer sk-endpoint-echo");
      },
    }), ["sk-endpoint-echo"]);
    expect(probe.error).not.toContain("sk-endpoint-echo");
    expect(probe.error).toContain("‹redacted›");
  });

  it("bounds an overlong reply", async () => {
    const probe = await probeLlm(
      settings,
      () => completerReturning({ text: "x".repeat(1000), toolCalls: [] }),
      [],
    );
    expect(probe.reply?.length).toBe(200);
  });
});
