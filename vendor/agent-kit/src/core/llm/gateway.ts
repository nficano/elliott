import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { LlmError } from "../errors.js";
import { consumeChatStream, mapFinish } from "./gateway/stream.js";
import {
  type ChatCompletion,
  ChatCompletionSchema,
  type EmbedRequest,
  EmbedResponseSchema,
  type EmbedResult,
  type GatewayConfig,
  type LlmPort,
  type StreamTurnResult,
  type ToolCall,
  type TurnRequest,
  type WireToolCallResp,
} from "./types.js";
import { mapUsage } from "./usage.js";
import { buildRequestBody } from "./wire.js";

const RESERVED_PARALLEL_SLOTS = 1;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_MAX_DELAY_MS = 15_000;
const RETRY_STAGGER_MS = 137;
const ERROR_DETAIL_MAX_CHARS = 500;

/**
 * LLM gateway (§7.1). Raw `fetch` to the LiteLLM OpenAI-compatible endpoint — no
 * vendor SDK. Per-key concurrency semaphore + transient retry (network/429/≥500)
 * inside. Streaming carries `stream_options.include_usage` for token telemetry.
 */
export class LiteLlmGateway implements LlmPort {
  private readonly gate: Semaphore.Semaphore;
  private readonly retrySchedule: ReturnType<typeof makeRetrySchedule>;

  constructor(private readonly cfg: GatewayConfig) {
    this.gate = Semaphore.makeUnsafe(
      Math.max(1, cfg.maxParallel - RESERVED_PARALLEL_SLOTS),
    );
    this.retrySchedule = makeRetrySchedule(
      cfg.maxRetries ?? DEFAULT_MAX_RETRIES,
    );
  }

  readonly streamTurn = Effect.fn("LiteLlmGateway.streamTurn")(
    { self: this },
    function*(
      this: LiteLlmGateway,
      req: TurnRequest,
    ): Effect.fn.Return<StreamTurnResult, LlmError> {
      return yield* this.request(() => this.doStream(req));
    },
  );

  readonly complete = Effect.fn("LiteLlmGateway.complete")(
    { self: this },
    function*(
      this: LiteLlmGateway,
      req: TurnRequest,
    ): Effect.fn.Return<StreamTurnResult, LlmError> {
      return yield* this.request(() => this.doComplete(req));
    },
  );

  readonly embed = Effect.fn("LiteLlmGateway.embed")(
    { self: this },
    function*(
      this: LiteLlmGateway,
      req: EmbedRequest,
    ): Effect.fn.Return<EmbedResult, LlmError> {
      return yield* this.request(() => this.doEmbed(req));
    },
  );

  private request<A>(operation: () => Promise<A>): Effect.Effect<A, LlmError> {
    return this.gate.withPermit(
      Effect.tryPromise({ try: operation, catch: asLlmError }),
    ).pipe(
      Effect.retry({
        schedule: this.retrySchedule,
        while: (error) => error.retryable,
      }),
    );
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${Redacted.value(this.cfg.apiKey)}`,
      "content-type": "application/json",
    };
  }

  private async doComplete(req: TurnRequest): Promise<StreamTurnResult> {
    const started = performance.now();
    const body = buildRequestBody({
      model: req.model.model,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      toolChoice: req.toolChoice,
      maxTokens: req.model.maxTokens,
      temperature: req.model.temperature,
      stream: false,
      cache: this.cfg.promptCache && req.cacheBreakpoint !== false,
    });
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    if (!res.ok) throw await httpError(res);
    const payload = await responseJson(res, "completion");
    const completion = await decodePayload(
      Schema.decodeUnknownPromise(ChatCompletionSchema),
      "completion",
      payload,
    );
    return completionResult(completion, req.model.model, started);
  }

  private async doStream(req: TurnRequest): Promise<StreamTurnResult> {
    const started = performance.now();
    const body = buildRequestBody({
      model: req.model.model,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      toolChoice: req.toolChoice,
      maxTokens: req.model.maxTokens,
      temperature: req.model.temperature,
      stream: true,
      cache: this.cfg.promptCache && req.cacheBreakpoint !== false,
    });
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    if (!res.ok || !res.body) throw await httpError(res);
    return consumeChatStream(res.body, req.model.model, started);
  }

  private async doEmbed(req: EmbedRequest): Promise<EmbedResult> {
    const model = req.model ?? this.cfg.embedModel;
    const res = await fetch(`${this.cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input: req.input }),
    });
    if (!res.ok) throw await httpError(res);
    const payload = await responseJson(res, "embedding");
    const json = await decodePayload(
      Schema.decodeUnknownPromise(EmbedResponseSchema),
      "embedding",
      payload,
    );
    const vectors = json.data.map((d) => [...d.embedding]);
    return {
      vectors,
      model: json.model ?? model,
      dim: vectors[0]?.length ?? 0,
    };
  }
}

function completionResult(
  completion: ChatCompletion,
  fallbackModel: string,
  startedAtMs: number,
): StreamTurnResult {
  const choice = completion.choices?.[0];
  const message = choice?.message;
  const totalMs = performance.now() - startedAtMs;
  return {
    text: message?.content ?? "",
    toolCalls: mapToolCalls(message?.tool_calls ?? []),
    finishReason: mapFinish(choice?.finish_reason),
    responseModel: completion.model ?? fallbackModel,
    usage: mapUsage(completion.usage),
    ttftMs: totalMs,
    totalMs,
  };
}

function mapToolCalls(
  calls: ReadonlyArray<WireToolCallResp>,
): ToolCall[] {
  return calls.map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));
}

async function httpError(res: Response): Promise<LlmError> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, ERROR_DETAIL_MAX_CHARS);
  } catch {
    /* ignore */
  }
  return new LlmError({
    message: `LiteLLM ${res.status}: ${detail}`,
    kind: "http",
    status: res.status,
  });
}

function asLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Error && e.name === "AbortError") {
    return new LlmError({ message: "aborted", kind: "protocol" });
  }
  return new LlmError({
    message: errorMessage(e),
    kind: "network",
    cause: e,
  });
}

function makeRetrySchedule(maxRetries: number) {
  return Schedule.recurs(maxRetries).pipe(
    Schedule.addDelay(({ attempt }) =>
      Effect.succeed(retryDelayMilliseconds(attempt - 1))
    ),
  );
}

function retryDelayMilliseconds(attempt: number): number {
  const backoff = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );
  return backoff + Math.floor(attempt * RETRY_STAGGER_MS);
}

async function responseJson(
  response: Response,
  kind: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw protocolError(`Invalid LiteLLM ${kind} JSON`, error);
  }
}

async function decodePayload<A>(
  decode: (input: unknown) => Promise<A>,
  kind: string,
  payload: unknown,
): Promise<A> {
  try {
    return await decode(payload);
  } catch (error) {
    throw protocolError(`Invalid LiteLLM ${kind} response`, error);
  }
}

function protocolError(message: string, cause: unknown): LlmError {
  return new LlmError({
    message: `${message}: ${errorMessage(cause)}`,
    kind: "protocol",
    cause,
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
