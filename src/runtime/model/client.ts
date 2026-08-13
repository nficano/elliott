import { hashValue } from "../../core/digest";
import type {
  ModelCallTimeouts,
  ModelCallWatchdog,
  ModelTurnRequest,
  ModelTurnResult,
  RuntimeSettings,
} from "../types";
import type { ModelWire } from "./types";
import { anthropicWire } from "./wire/anthropic";
import { openaiWire } from "./wire/openai";

const RESPONSE_DETAIL_MAX_CHARACTERS = 500;
const MILLISECONDS_PER_SECOND = 1000;

// A hung upstream used to fail only at Bun's opaque default fetch deadline
// (~300s, surfacing as a bare TimeoutError in the turn). The watchdog bounds
// *inactivity* instead of total time: the initial window covers
// time-to-first-byte (a non-streaming completion generates fully before
// answering), and every streamed chunk then resets a shorter gap allowance —
// so long healthy generations are never cut while a stalled upstream fails in
// bounded time with a nameable error.
const INITIAL_RESPONSE_TIMEOUT_MILLISECONDS = 240_000;
const STREAM_INACTIVITY_TIMEOUT_MILLISECONDS = 90_000;

const DEFAULT_TIMEOUTS: ModelCallTimeouts = {
  initialMilliseconds: INITIAL_RESPONSE_TIMEOUT_MILLISECONDS,
  inactivityMilliseconds: STREAM_INACTIVITY_TIMEOUT_MILLISECONDS,
};

// Wires are selected at the config boundary and resolved here. The client
// owns transport only — timeouts, HTTP failure, and route attestation — so a
// new provider protocol never touches this file's failure handling.
const WIRES: Readonly<Record<RuntimeSettings["llmWire"], ModelWire>> = Object
  .freeze({
    anthropic: anthropicWire,
    openai: openaiWire,
  });

export class RuntimeModelClient {
  readonly #settings: RuntimeSettings;
  readonly #timeouts: ModelCallTimeouts;
  readonly #wire: ModelWire;

  constructor(
    settings: RuntimeSettings,
    timeouts: ModelCallTimeouts = DEFAULT_TIMEOUTS,
  ) {
    this.#settings = settings;
    this.#timeouts = timeouts;
    this.#wire = WIRES[settings.llmWire];
  }

  async complete(
    request: ModelTurnRequest,
    onTextDelta?: (delta: string) => Promise<void>,
  ): Promise<ModelTurnResult> {
    const watchdog = startWatchdog(this.#timeouts, this.#wire.name);
    try {
      return await this.#request(request, onTextDelta, watchdog);
    } catch (error) {
      // Bun may surface an abort as its own AbortError; the watchdog's
      // reason names the stall, so prefer it.
      throw watchdog.signal.aborted ? watchdog.signal.reason : error;
    } finally {
      watchdog.stop();
    }
  }

  async #request(
    request: ModelTurnRequest,
    onTextDelta: ((delta: string) => Promise<void>) | undefined,
    watchdog: ModelCallWatchdog,
  ): Promise<ModelTurnResult> {
    const streaming = onTextDelta !== undefined;
    const encoded = this.#wire.request(this.#settings, request, streaming);
    const response = await fetch(encoded.url, {
      method: "POST",
      headers: { ...encoded.headers },
      body: JSON.stringify(encoded.body),
      signal: watchdog.signal,
    });
    watchdog.touch();
    if (!response.ok) {
      const detail = (await response.text()).slice(
        0,
        RESPONSE_DETAIL_MAX_CHARACTERS,
      );
      throw new Error(
        `${this.#wire.name} ${response.status}: ${detail}`,
      );
    }
    const result = onTextDelta === undefined
      ? this.#wire.decode(await response.json())
      : await this.#wire.decodeStream(response, onTextDelta, watchdog.touch);
    return this.#attest(result);
  }

  #attest(result: ModelTurnResult): ModelTurnResult {
    const routeDigest = hashValue({
      baseUrl: this.#settings.llmBaseUrl,
      wire: this.#settings.llmWire,
      model: this.#settings.model,
    });
    return {
      ...result,
      selection: {
        routeDigest,
        usageReference: hashValue({
          routeDigest,
          usage: result.usage ?? null,
          response: hashValue({
            text: result.text,
            toolCalls: result.toolCalls,
          }),
        }),
      },
    };
  }
}

const startWatchdog = (
  timeouts: ModelCallTimeouts,
  wireName: string,
): ModelCallWatchdog => {
  const controller = new AbortController();
  let waitMilliseconds = timeouts.initialMilliseconds;
  const expire = (): void => {
    const seconds = Math.round(waitMilliseconds / MILLISECONDS_PER_SECOND);
    controller.abort(
      new Error(`Model call stalled (${wireName}): no data for ${seconds}s`),
    );
  };
  let timer = setTimeout(expire, waitMilliseconds);
  return {
    signal: controller.signal,
    touch: (): void => {
      clearTimeout(timer);
      waitMilliseconds = timeouts.inactivityMilliseconds;
      timer = setTimeout(expire, waitMilliseconds);
    },
    stop: (): void => {
      clearTimeout(timer);
    },
  };
};
