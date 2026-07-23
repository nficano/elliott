import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type {
  HttpClient,
  HttpRequest,
  MakeHttpOptions,
  RequestRuntime,
} from "./types.js";

/**
 * The shared HTTP core every integration client builds on (CAPABILITIES-TDD
 * §9.4). Clean-room reimplementation of the prior art's discipline: a non-2xx
 * is a typed `<service>.http` error with the status and a clipped body; a fetch
 * throw is `<service>.network`; bad JSON is `<service>.parse`. Nothing throws —
 * always an Effect. Transient failures (429/5xx/network) retry with capped
 * jittered backoff.
 */

export class IntegrationError
  extends Schema.TaggedErrorClass<IntegrationError>()("IntegrationError", {
    /** `<service>.<phase>` — http | network | parse | input | config | auth | api. */
    tag: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  })
{
  get retryable(): boolean {
    if (this.tag.endsWith(".network")) return true;
    if (this.status === undefined) return false;
    return this.status === HTTP_TOO_MANY_REQUESTS
      || this.status >= HTTP_SERVER_ERROR_MIN;
  }
}

const BODY_CLIP = 300;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const DEFAULT_TIMEOUT_MS = 15_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const JITTER_FLOOR = 0.5;
const RANDOM_UINT_BITS = 32;
const JITTER_DIVISOR = 2;

function randomUnit(): number {
  const value = crypto.getRandomValues(new Uint32Array(1)).at(0) ?? 0;
  return value / (2 ** RANDOM_UINT_BITS);
}

export function makeHttp(
  service: string,
  opts: MakeHttpOptions = {},
): HttpClient {
  const runtime: RequestRuntime = {
    service,
    doFetch: opts.fetchImpl ?? fetch,
    random: opts.random ?? randomUnit,
    ...(opts.sleep && { sleep: opts.sleep }),
  };
  const fetchText = makeFetchText(runtime);

  function fetchJson<T>(
    req: HttpRequest,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, IntegrationError> {
    return fetchText(req).pipe(
      Effect.flatMap(({ text }) => parseJson(service, text, schema)),
    );
  }

  return { fetchText, fetchJson };
}

function makeFetchText(runtime: RequestRuntime): HttpClient["fetchText"] {
  return Effect.fn("integration.http.fetchText")(
    function*(req: HttpRequest) {
      return yield* attempt(req, runtime).pipe(
        Effect.retry(($) =>
          makeRetryPolicy(runtime, $(Schedule.exponential(BASE_BACKOFF_MS)))
        ),
      );
    },
  );
}

function makeRetryPolicy(
  runtime: RequestRuntime,
  schedule: Schedule.Schedule<Duration.Duration, IntegrationError>,
): Schedule.Schedule<
  Duration.Duration,
  IntegrationError,
  IntegrationError
> {
  const retryPolicy = schedule.pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.sync(() =>
        Duration.millis(
          Duration.toMillis(duration)
            * (JITTER_FLOOR + runtime.random() / JITTER_DIVISOR),
        )
      )
    ),
    Schedule.upTo({ times: MAX_ATTEMPTS - 1 }),
    Schedule.while(({ input }) => input.retryable),
  );
  return runtime.sleep === undefined
    ? retryPolicy
    : retryPolicy.pipe(
      Schedule.tap(({ duration }) =>
        sleep(runtime, Duration.toMillis(duration))
      ),
      Schedule.modifyDelay(() => Effect.succeed(Duration.zero)),
    );
}

const attempt = Effect.fn("integration.http.attempt")(
  function*(req: HttpRequest, runtime: RequestRuntime) {
    const response = yield* Effect.tryPromise({
      try: () =>
        runtime.doFetch(req.url, {
          method: req.method ?? "GET",
          ...(req.headers && { headers: req.headers }),
          ...((req.body !== undefined) && { body: req.body }),
          signal: AbortSignal.timeout(
            req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ),
        }),
      catch: (cause) => networkError(runtime.service, cause),
    });
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => networkError(runtime.service, cause),
    });
    if (!response.ok) {
      return yield* IntegrationError.make({
        tag: `${runtime.service}.http`,
        message: `${runtime.service}: HTTP ${response.status}: ${
          text.slice(0, BODY_CLIP)
        }`,
        status: response.status,
      });
    }
    return { status: response.status, text };
  },
);

function parseJson<T>(
  service: string,
  text: string,
  schema: Schema.Decoder<T>,
): Effect.Effect<T, IntegrationError> {
  return Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
    Effect.mapError((cause) =>
      IntegrationError.make({
        tag: `${service}.parse`,
        message: `${service}: invalid JSON: ${text.slice(0, BODY_CLIP)}`,
        cause,
      })
    ),
  );
}

function sleep(
  runtime: RequestRuntime,
  milliseconds: number,
): Effect.Effect<void, IntegrationError> {
  const sleeper = runtime.sleep;
  if (sleeper === undefined) return Effect.void;
  return Effect.tryPromise({
    try: () => sleeper(milliseconds),
    catch: (cause) => networkError(runtime.service, cause),
  });
}

function networkError(service: string, cause: unknown): IntegrationError {
  return IntegrationError.make({
    tag: `${service}.network`,
    message: `${service}: ${
      cause instanceof Error ? cause.message : "fetch failed"
    }`,
    cause,
  });
}
