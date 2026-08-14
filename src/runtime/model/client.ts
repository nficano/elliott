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

const REDACTION = "‹redacted›";

// Strip the userinfo (`user:pass@`) from any URL the endpoint echoes back, and
// replace the credential this client authenticates with. The endpoint is the one
// party that is GIVEN the api key, so a hostile or compromised one can quote it
// straight back in an error body; `detail` is endpoint-controlled text. Both
// scrubs target values this process already knows, so neither is a guess about
// what a credential looks like. Doctrine (CLAUDE.md) forbids logging a secret,
// not merely transmitting one — process logs get shipped off-box in every real
// deployment, so "local console only" is not a safe place to put a key.
const URL_WITH_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/)[^/?#\s]*@/g;
const scrubDetail = (detail: string, apiKey: string | undefined): string => {
  const withoutUserinfo = detail.replaceAll(URL_WITH_USERINFO, "$1");
  return apiKey === undefined || apiKey.trim().length === 0
    ? withoutUserinfo
    : withoutUserinfo.split(apiKey).join(REDACTION);
};

// A non-2xx model response. Carries the HTTP `status` as structured data so a
// caller (e.g. the doctor) can classify the failure from a fact it derived —
// the status code — without parsing or echoing the provider's response body,
// which is endpoint-controlled and may quote credentials. The body is kept for
// LOCAL debugging, but only after the credentials this process knows are
// scrubbed out of it: an endpoint that echoes the api key must not be able to
// write it into the operator's logs.
export class ModelHttpError extends Error {
  readonly status: number;
  constructor(
    wireName: string,
    status: number,
    detail: string,
    apiKey?: string,
  ) {
    super(`${wireName} ${status}: ${scrubDetail(detail, apiKey)}`);
    this.name = "ModelHttpError";
    this.status = status;
  }
}

// A 2xx response whose body could not be decoded into a completion (invalid
// JSON, or a shape the wire does not accept). The `decode` marker lets a caller
// distinguish "reachable endpoint returned garbage" from "endpoint unreachable"
// without inspecting the message. The message keeps the cause for LOCAL
// debugging only.
export class ModelDecodeError extends Error {
  readonly decode = true;
  constructor(wireName: string, cause: unknown) {
    super(`${wireName}: response could not be decoded`, { cause });
    this.name = "ModelDecodeError";
  }
}

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
      throw new ModelHttpError(
        this.#wire.name,
        response.status,
        detail,
        this.#settings.llmApiKey,
      );
    }
    return this.#attest(await this.#decode(response, onTextDelta, watchdog));
  }

  // Decode a 2xx response into a completion. A malformed body (bad JSON, a shape
  // the wire rejects) is a reachable-but-broken endpoint, not a transport
  // failure, so it is surfaced as a distinct ModelDecodeError rather than
  // leaking out as a bare parse error the caller would misread as unreachable.
  async #decode(
    response: Response,
    onTextDelta: ((delta: string) => Promise<void>) | undefined,
    watchdog: ModelCallWatchdog,
  ): Promise<ModelTurnResult> {
    try {
      return onTextDelta === undefined
        ? this.#wire.decode(await response.json())
        : await this.#wire.decodeStream(response, onTextDelta, watchdog.touch);
    } catch (error) {
      throw new ModelDecodeError(this.#wire.name, error);
    }
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
