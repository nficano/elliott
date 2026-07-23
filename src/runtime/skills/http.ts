import { isJsonRecord } from "../../providers/http";

export const MAX_TOOL_OUTPUT_CHARACTERS = 12_000;

const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const IPV4_SEGMENTS = 4;
const LINK_LOCAL_FIRST_OCTET = 169;
const LINK_LOCAL_SECOND_OCTET = 254;
const PRIVATE_172_LOW = 16;
const PRIVATE_172_HIGH = 31;
const PRIVATE_192_SECOND_OCTET = 168;
const LOOPBACK_FIRST_OCTET = 127;
const PRIVATE_10_FIRST_OCTET = 10;
const PRIVATE_172_FIRST_OCTET = 172;
const PRIVATE_192_FIRST_OCTET = 192;

export const request = async (
  url: string | URL,
  headers: Readonly<Record<string, string>> = {},
  body?: unknown,
): Promise<Response> => {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return response;
};

export const publicUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS destinations are allowed");
  }
  if (
    url.username.length > 0 || url.password.length > 0
    || privateHost(url.hostname)
  ) {
    throw new Error(
      `Destination ${url.hostname} is outside the public egress grant`,
    );
  }
  return url;
};

const privateHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local")) return true;
  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== IPV4_SEGMENTS
    || parts.some((part) => !Number.isSafeInteger(part))
  ) {
    return normalized.includes(":");
  }
  return privateIpv4(parts[0] ?? 0, parts[1] ?? 0);
};

const privateIpv4 = (first: number, second: number): boolean =>
  first === PRIVATE_10_FIRST_OCTET || first === LOOPBACK_FIRST_OCTET
  || first === 0
  || (first === LINK_LOCAL_FIRST_OCTET && second === LINK_LOCAL_SECOND_OCTET)
  || (first === PRIVATE_172_FIRST_OCTET && second >= PRIVATE_172_LOW
    && second <= PRIVATE_172_HIGH)
  || (first === PRIVATE_192_FIRST_OCTET
    && second === PRIVATE_192_SECOND_OCTET);

export const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> => ({
  type: "object",
  properties,
  required,
});

export const requiredString = (input: unknown, key: string): string => {
  if (!isJsonRecord(input) || typeof input[key] !== "string") {
    throw new Error(`Tool argument ${key} must be a string`);
  }
  return input[key];
};

export const optionalInteger = (
  input: unknown,
  key: string,
  bounds: {
    readonly min: number;
    readonly max: number;
    readonly fallback: number;
  },
): number => {
  if (!isJsonRecord(input) || typeof input[key] !== "number") {
    return bounds.fallback;
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.floor(input[key])));
};

export const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const stripActiveHtml = (input: string): string =>
  stripTags(stripElement(stripElement(input, "script"), "style"))
    .replaceAll(/\s+/g, " ")
    .trim();

const stripTags = (input: string): string => {
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = input.indexOf("<", cursor);
    if (start === -1) return output + input.slice(cursor);
    const end = input.indexOf(">", start + 1);
    if (end === -1) return output + input.slice(cursor);
    output += `${input.slice(cursor, start)} `;
    cursor = end + 1;
  }
};

const stripElement = (input: string, name: string): string => {
  const close = `</${name}>`;
  let output = input;
  for (;;) {
    const lower = output.toLowerCase();
    const start = lower.indexOf(`<${name}`);
    if (start === -1) return output;
    const end = lower.indexOf(close, start);
    output = end === -1
      ? output.slice(0, start)
      : output.slice(0, start) + output.slice(end + close.length);
  }
};
