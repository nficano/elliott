import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { LlmError } from "../src/core/errors.js";
import { LiteLlmGateway } from "../src/core/llm/gateway.js";
import type { TurnRequest } from "../src/core/llm/types.js";

const RETRY_CLOCK_ADVANCE_MS = 10_000;

const request: TurnRequest = {
  model: {
    model: "test-model",
    tier: "fast",
    maxTokens: 100,
    temperature: 0,
    allowFallback: true,
  },
  system: "test",
  messages: [],
  tools: [],
};

afterEach(() => {
  mock.restore();
});

describe("LiteLlmGateway", () => {
  test("retries retryable HTTP failures with the Effect schedule", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls < 3) return new Response("temporary", { status: 503 });
      return completionResponse("retried");
    });

    const gateway = makeGateway({ maxRetries: 2 });
    const program = Effect.gen(function*() {
      const fiber = yield* gateway.complete(request).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(RETRY_CLOCK_ADVANCE_MS);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()));

    const result = await Effect.runPromise(program);
    expect(result.text).toBe("retried");
    expect(calls).toBe(3);
  });

  test("returns a non-retryable LlmError for malformed responses", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: 42 } }] });
    });

    const error = await Effect.runPromise(
      makeGateway({ maxRetries: 3 }).complete(request).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("protocol");
    expect(error.retryable).toBe(false);
    expect(calls).toBe(1);
  });

  test("schema-decodes streaming chunks into protocol errors", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return new Response(
        "data: {\"choices\":[{\"delta\":{\"content\":42}}]}\n\n",
      );
    });

    const error = await Effect.runPromise(
      makeGateway({ maxRetries: 3 }).streamTurn(request).pipe(Effect.flip),
    );

    expect(error.kind).toBe("protocol");
    expect(error.message).toContain("stream chunk");
    expect(calls).toBe(1);
  });

  test("shares the Effect semaphore across concurrent requests", async () => {
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    mockFetch(() =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        pending.push(() => {
          active--;
          resolve(completionResponse("ok"));
        });
      })
    );

    const gateway = makeGateway({ maxRetries: 0 });
    const running = Effect.runPromise(
      Effect.all(
        Array.from({ length: 4 }, () => gateway.complete(request)),
        { concurrency: "unbounded" },
      ),
    );

    await waitFor(() => pending.length === 2);
    releasePending(pending);
    await waitFor(() => pending.length === 2);
    releasePending(pending);

    const results = await running;
    expect(results).toHaveLength(4);
    expect(peak).toBe(2);
  });
});

function mockFetch(implementation: () => Promise<Response>): void {
  const fetchImplementation = Object.assign(
    (...args: Parameters<typeof fetch>) => {
      void args;
      return implementation();
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);
}

function makeGateway(
  options: { readonly maxRetries: number; },
): LiteLlmGateway {
  return new LiteLlmGateway({
    baseUrl: "https://llm.test",
    apiKey: Redacted.make("secret"),
    maxParallel: 3,
    promptCache: false,
    embedModel: "test-embed",
    maxRetries: options.maxRetries,
  });
}

function completionResponse(content: string): Response {
  return Response.json({
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 1,
      total_tokens: 3,
    },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Bun.sleep(0);
  }
  throw new Error("Timed out waiting for concurrent requests");
}

function releasePending(pending: Array<() => void>): void {
  for (const release of pending) release();
  pending.length = 0;
}
