import {
  DarwinWireError,
  errorResponse,
  jsonResponse,
  readJsonRequest,
  requestIsAuthorized,
  wireError,
} from "./wire";

const DEFAULT_PORT = 9073;
const DEFAULT_MAXIMUM_JOBS = 1;
const IDLE_TIMEOUT_SECONDS = 255;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export interface DarwinServerConfig {
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly maximumJobs: number;
  readonly token: string;
}

export type DarwinHandler = (value: unknown) => unknown;

export interface DarwinRoutes {
  readonly [path: string]: DarwinHandler;
}

export type DarwinFetchHandler = (request: Request) => Promise<Response>;

class ConcurrencyGate {
  #active = 0;

  constructor(readonly maximum: number) {}

  use = async <A>(operation: () => Promise<A>): Promise<A> => {
    if (this.#active >= this.maximum) {
      return wireError(
        "darwin concurrency limit reached",
        HTTP_TOO_MANY_REQUESTS,
      );
    }
    this.#active += 1;
    try {
      return await operation();
    } finally {
      this.#active -= 1;
    }
  };
}

const positiveInteger = (value: string | undefined, name: string): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : wireError(
      `${name} must be a positive integer`,
      HTTP_INTERNAL_SERVER_ERROR,
    );
};

const argument = (
  arguments_: readonly string[],
  name: string,
): string | undefined => {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
};

const requireLoopbackHost = (rawHost: string): "127.0.0.1" | "::1" => {
  if (rawHost !== "127.0.0.1" && rawHost !== "::1") {
    return wireError(
      "darwin server must bind to loopback",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return rawHost;
};

const resolveToken = (
  environment: Readonly<Record<string, string | undefined>>,
  required: boolean,
): string => {
  const fixture = environment["ELLIOTT_DARWIN_FIXTURE"] === "1";
  const token = environment["ELLIOTT_DARWIN_TOKEN"];
  if (required && !fixture && (token === undefined || token.length === 0)) {
    return wireError(
      "ELLIOTT_DARWIN_TOKEN is required outside fixture mode",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return token ?? "";
};

export const loadDarwinServerConfig = (
  arguments_: readonly string[] = Bun.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  tokenRequired = true,
): DarwinServerConfig => {
  const host = requireLoopbackHost(
    argument(arguments_, "--host") ?? "127.0.0.1",
  );
  return {
    host,
    port: positiveInteger(
      argument(arguments_, "--port") ?? String(DEFAULT_PORT),
      "port",
    ),
    maximumJobs: positiveInteger(
      argument(arguments_, "--maximum-jobs") ?? String(DEFAULT_MAXIMUM_JOBS),
      "maximum-jobs",
    ),
    token: resolveToken(environment, tokenRequired),
  };
};

const logRequest = (
  request: Request,
  status: number,
  elapsedMilliseconds: number,
): void => {
  console.error(
    JSON.stringify({
      event: "darwin.http",
      method: request.method,
      path: new URL(request.url).pathname,
      status,
      elapsedMilliseconds: Math.round(elapsedMilliseconds),
    }),
  );
};

const authorize = (
  request: Request,
  token: string,
): void => {
  if (token.length > 0 && !requestIsAuthorized(request, token)) {
    throw DarwinWireError.make({
      message: "unauthorized",
      status: HTTP_UNAUTHORIZED,
    });
  }
};

const dispatch = async (
  request: Request,
  routes: DarwinRoutes,
  gate: ConcurrencyGate,
): Promise<Response> => {
  const handler = routes[new URL(request.url).pathname];
  if (handler === undefined) {
    return jsonResponse({ error: "not found" }, HTTP_NOT_FOUND);
  }
  const body = await readJsonRequest(request);
  const result = await gate.use(() => Promise.resolve(handler(body)));
  return jsonResponse(result);
};

export const makeDarwinFetchHandler = (
  config: DarwinServerConfig,
  routes: DarwinRoutes,
): DarwinFetchHandler => {
  const gate = new ConcurrencyGate(config.maximumJobs);
  return async (request) => {
    const started = performance.now();
    let response: Response;
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        response = jsonResponse({ status: "ok" });
      } else if (request.method === "POST") {
        authorize(request, config.token);
        response = await dispatch(request, routes, gate);
      } else {
        response = jsonResponse({ error: "not found" }, HTTP_NOT_FOUND);
      }
    } catch (error) {
      response = errorResponse(error);
    }
    logRequest(request, response.status, performance.now() - started);
    return response;
  };
};

export const startDarwinServer = (
  config: DarwinServerConfig,
  routes: DarwinRoutes,
): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: makeDarwinFetchHandler(config, routes),
  });
