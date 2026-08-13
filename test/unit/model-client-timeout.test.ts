import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { RuntimeModelClient } from "../../src/runtime/model/client";
import type {
  ModelTurnRequest,
  RuntimeSettings,
} from "../../src/runtime/types";

// The model-call watchdog: a hung LiteLLM upstream must fail in bounded time
// with a nameable error, while slow-but-active streams are never cut. The
// fetch double honors the abort signal the way real fetch does (rejecting the
// pending promise / erroring the body stream), which is exactly the wiring
// the watchdog depends on.

afterEach(() => {
  mock.restore();
});

const settings = {
  llmBaseUrl: "https://litellm.test/v1",
  llmWire: "openai",
  llmApiKey: "sk-test",
  model: "test-model",
  maxTokens: 128,
  temperature: 0,
} as RuntimeSettings;

const turn: ModelTurnRequest = {
  system: "You are a test.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  allowTools: false,
};

const encoder = new TextEncoder();

const sseEvent = (value: unknown): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

const contentEvent = (text: string): Uint8Array =>
  sseEvent({ choices: [{ delta: { content: text } }] });

// A streaming Response whose chunks arrive on the given schedule and whose
// body errors when the request signal aborts — mirroring real fetch.
const streamingFetch = (
  chunks: readonly { readonly at: number; readonly data: Uint8Array; }[],
  done: boolean,
): void => {
  const impl = (_input: unknown, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const chunk of chunks) {
          setTimeout(() => controller.enqueue(chunk.data), chunk.at);
        }
        if (done) {
          const last = Math.max(0, ...chunks.map((chunk) => chunk.at));
          setTimeout(() => {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }, last + 5);
        }
        signal?.addEventListener("abort", () => {
          controller.error(signal.reason);
        });
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  };
  spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
};

describe("model call watchdog", () => {
  it("aborts a stalled stream with a nameable error", async () => {
    // One chunk arrives, then the upstream goes silent forever.
    streamingFetch([{ at: 0, data: contentEvent("hel") }], false);
    const client = new RuntimeModelClient(settings, {
      initialMilliseconds: 500,
      inactivityMilliseconds: 60,
    });

    await expect(client.complete(turn, async () => {}))
      .rejects.toThrow(/Model call stalled \(OpenAI-compatible\): no data for/);
  });

  it("lets a slow-but-active stream finish", async () => {
    // Chunks every ~25ms with a 150ms gap allowance: total time exceeds the
    // inactivity window several times over, but no single gap does.
    streamingFetch([
      { at: 0, data: contentEvent("a") },
      { at: 25, data: contentEvent("b") },
      { at: 50, data: contentEvent("c") },
      { at: 75, data: contentEvent("d") },
    ], true);
    const client = new RuntimeModelClient(settings, {
      initialMilliseconds: 500,
      inactivityMilliseconds: 150,
    });

    const result = await client.complete(turn, async () => {});
    expect(result.text).toBe("abcd");
  });

  it("bounds time-to-first-byte through the initial window", async () => {
    // The upstream never answers; the fetch double rejects on abort exactly
    // like real fetch would.
    const impl = (_input: unknown, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const reason = init.signal?.reason as unknown;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      });
    spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
    const client = new RuntimeModelClient(settings, {
      initialMilliseconds: 50,
      inactivityMilliseconds: 500,
    });

    await expect(client.complete(turn)).rejects.toThrow(
      "Model call stalled (OpenAI-compatible): no data for 0s",
    );
  });

  it("does not fire after a completed call", async () => {
    streamingFetch([{ at: 0, data: contentEvent("ok") }], true);
    const client = new RuntimeModelClient(settings, {
      initialMilliseconds: 500,
      inactivityMilliseconds: 40,
    });

    const result = await client.complete(turn, async () => {});
    expect(result.text).toBe("ok");
    // The watchdog was stopped; waiting past the inactivity window must not
    // leave an abort timer behind (unhandled rejection would fail the run).
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
});
