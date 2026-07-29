import * as Schema from "effect/Schema";
import { createHash, timingSafeEqual } from "node:crypto";

const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;
const MAX_PAYLOAD_MEBIBYTES = 32;
export const MAX_REQUEST_BYTES = MAX_PAYLOAD_MEBIBYTES * MEBIBYTE;
export const MAX_RESPONSE_BYTES = MAX_PAYLOAD_MEBIBYTES * MEBIBYTE;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const MAX_ERROR_MESSAGE_CHARACTERS = 4096;
const BEARER_PREFIX = "Bearer ";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export class CompanionWireError
  extends Schema.TaggedErrorClass<CompanionWireError>()(
    "CompanionWireError",
    {
      message: Schema.String,
      status: Schema.Literals([
        HTTP_BAD_REQUEST,
        HTTP_UNAUTHORIZED,
        HTTP_NOT_FOUND,
        HTTP_PAYLOAD_TOO_LARGE,
        HTTP_TOO_MANY_REQUESTS,
        HTTP_INTERNAL_SERVER_ERROR,
      ]),
    },
  )
{}

export const wireError = (
  message: string,
  status: CompanionWireError["status"] = HTTP_BAD_REQUEST,
): never => {
  throw CompanionWireError.make({ message, status });
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const sha256Text = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const jsonResponse = (
  value: unknown,
  status = HTTP_OK,
): Response => {
  const body = canonicalJson(value);
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    return jsonResponse(
      { error: "response exceeds the size limit" },
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
};

export const readJsonRequest = async (request: Request): Promise<unknown> => {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) {
    wireError("content-length is required", HTTP_BAD_REQUEST);
  }
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    wireError("content-length is invalid", HTTP_BAD_REQUEST);
  }
  if (length > MAX_REQUEST_BYTES) {
    wireError("request exceeds the size limit", HTTP_PAYLOAD_TOO_LARGE);
  }
  const body = await request.text();
  if (Buffer.byteLength(body) !== length) {
    wireError(
      "content-length does not match the request body",
      HTTP_BAD_REQUEST,
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    return wireError("request body is not valid JSON", HTTP_BAD_REQUEST);
  }
};

const safeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
};

export const requestIsAuthorized = (
  request: Request,
  token: string,
): boolean => {
  const header = request.headers.get("authorization");
  return header !== null
    && header.startsWith(BEARER_PREFIX)
    && safeEqual(header.slice(BEARER_PREFIX.length), token);
};

export const errorResponse = (cause: unknown): Response => {
  if (cause instanceof CompanionWireError) {
    return jsonResponse({ error: cause.message }, cause.status);
  }
  const message = cause instanceof Error
    ? `${cause.name}: ${cause.message}`.slice(0, MAX_ERROR_MESSAGE_CHARACTERS)
    : "unknown server error";
  return jsonResponse({ error: message }, HTTP_INTERNAL_SERVER_ERROR);
};

export const decodeUnknown = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  name: string,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return wireError(`${name} is invalid: ${detail}`, HTTP_BAD_REQUEST);
  }
};

const isLoopbackHttpUrl = (endpoint: URL): boolean =>
  HTTP_PROTOCOLS.has(endpoint.protocol)
  && LOOPBACK_HOSTS.has(endpoint.hostname)
  && endpoint.username.length === 0
  && endpoint.password.length === 0
  && endpoint.search.length === 0
  && endpoint.hash.length === 0;

export const requireLoopbackEndpoint = (
  rawEndpoint: string | undefined,
  token: string | undefined,
  name: string,
): { readonly endpoint: URL; readonly token: string; } => {
  if (rawEndpoint === undefined || token === undefined || token.length === 0) {
    return wireError(
      `${name} endpoint and token are required`,
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    return wireError(`${name} endpoint is invalid`, HTTP_INTERNAL_SERVER_ERROR);
  }
  if (!isLoopbackHttpUrl(endpoint)) {
    return wireError(
      `${name} must be an HTTP loopback endpoint`,
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return { endpoint, token };
};
