import { isJsonRecord } from "../../../src/providers/http";
import type { SlackSettings } from "../../../src/runtime/types";
import { sanitizeSlackDisplayPayload } from "./emoji";
import type {
  SlackApiClient,
  SlackClientOptions,
  SlackClientSet,
  SlackJson,
} from "./types";

export const SLACK_API = "https://slack.com/api";

const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_MILLISECONDS = 1000;
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_TOO_MANY_REQUESTS = 429;
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;

export class SlackApiError extends Error {
  readonly method: string;
  readonly code: string;
  readonly status: number;

  constructor(method: string, code: string, status: number) {
    super(`Slack ${method} failed: ${code}`);
    this.name = "SlackApiError";
    this.method = method;
    this.code = code;
    this.status = status;
  }
}

export class SlackWebClient implements SlackApiClient {
  readonly #token: string;
  readonly #fetcher: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: SlackClientOptions) {
    this.#token = options.token;
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? delay;
  }

  async request(method: string, body: SlackJson = {}): Promise<SlackJson> {
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const response = await this.#fetcher(`${SLACK_API}/${method}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
      const value = await decodeResponse(response, method);
      if (response.ok && value["ok"] === true) return value;
      const limited = response.status === HTTP_TOO_MANY_REQUESTS
        || value["error"] === "ratelimited"
        || value["error"] === "rate_limited";
      if (!limited || attempt === MAX_RATE_LIMIT_RETRIES) {
        throw apiError(method, response, value);
      }
      await this.#sleep(retryDelay(response));
    }
    throw new SlackApiError(method, "retry_exhausted", 0);
  }
}

export const makeSlackClients = (
  settings: SlackSettings,
): SlackClientSet => {
  const user = settings.userToken === undefined
    ? {}
    : { user: new SlackWebClient({ token: settings.userToken }) };
  return {
    app: new SlackWebClient({ token: settings.appToken }),
    bot: new SlackWebClient({ token: settings.botToken }),
    ...user,
  };
};

export const postMessage = async (
  client: SlackApiClient,
  args: SlackJson,
): Promise<string> => {
  const response = await client.request(
    "chat.postMessage",
    sanitizeSlackDisplayPayload(args),
  );
  const timestamp = response["ts"];
  if (typeof timestamp !== "string") {
    throw new SlackApiError("chat.postMessage", "missing_timestamp", 0);
  }
  return timestamp;
};

const decodeResponse = async (
  response: Response,
  method: string,
): Promise<SlackJson> => {
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SlackApiError(method, `invalid_json:${detail}`, response.status);
  }
  if (!isJsonRecord(value)) {
    throw new SlackApiError(method, "invalid_json_shape", response.status);
  }
  return value;
};

const apiError = (
  method: string,
  response: Response,
  value: SlackJson,
): SlackApiError => {
  const code = value["error"];
  return new SlackApiError(
    method,
    typeof code === "string" ? code : `http_${response.status}`,
    response.status,
  );
};

const retryDelay = (response: Response): number => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * MILLISECONDS_PER_SECOND
    : DEFAULT_RETRY_MILLISECONDS;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
