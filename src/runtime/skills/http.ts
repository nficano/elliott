import { createHmac, timingSafeEqual } from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { isJsonRecord } from "../../providers/http";
import type { AddressResolver } from "./types";

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
const IPV6_UNIQUE_LOCAL_LOW = 0xFC_00;
const IPV6_UNIQUE_LOCAL_HIGH = 0xFD_FF;
const IPV6_LINK_LOCAL_LOW = 0xFE_80;
const IPV6_LINK_LOCAL_HIGH = 0xFE_BF;
const IPV4_MAPPED_IPV6 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/;
const IP_FAMILY_V4 = 4;
const IP_FAMILY_V6 = 6;

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

const defaultResolver: AddressResolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((record) => record.address);

// A hostname string can never prove a destination is public — an attacker
// picks the name, and DNS is what decides where it actually goes (nip.io,
// sslip.io, and plain DNS rebinding all resolve an innocuous-looking name to
// a private address). So this resolves the name and validates every address
// it answers to, not just the text of the name itself. `resolve` defaults to
// a real DNS lookup; tests inject a fake one to stay offline and
// deterministic.
export const publicUrl = async (
  value: string,
  resolve: AddressResolver = defaultResolver,
): Promise<URL> => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS destinations are allowed");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(
      `Destination ${url.hostname} is outside the public egress grant`,
    );
  }
  // URL.hostname keeps the brackets around an IPv6 literal ("[::1]"), but
  // net.isIP() only recognizes the bare form — strip them so a literal IPv6
  // address is checked directly instead of being sent through DNS
  // resolution as if it were a name.
  const hostname = stripBrackets(url.hostname.toLowerCase());
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error(
      `Destination ${url.hostname} is outside the public egress grant`,
    );
  }
  const addresses = await resolvedAddresses(hostname, resolve);
  if (addresses.some(isPrivateAddress)) {
    throw new Error(
      `Destination ${url.hostname} is outside the public egress grant`,
    );
  }
  return url;
};

const stripBrackets = (value: string): string =>
  value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;

const resolvedAddresses = async (
  hostname: string,
  resolve: AddressResolver,
): Promise<readonly string[]> => {
  // A literal IP address needs no lookup — it already is the destination.
  if (isIP(hostname) !== 0) return [hostname];
  try {
    return await resolve(hostname);
  } catch (error) {
    throw new Error(
      `Destination ${hostname} could not be resolved: ${String(error)}`,
      { cause: error },
    );
  }
};

const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === IP_FAMILY_V4) return privateIpv4(address);
  if (family === IP_FAMILY_V6) return privateIpv6(address);
  return true; // not a recognizable IP literal from a resolver — fail closed
};

const privateIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== IPV4_SEGMENTS
    || parts.some((part) => !Number.isSafeInteger(part))
  ) {
    return true; // unparseable — fail closed
  }
  const [first = -1, second = -1] = parts;
  return isSimplePrivateOctet(first) || isPrivateLinkLocalIpv4(first, second)
    || isPrivate172Ipv4(first, second) || isPrivate192Ipv4(first, second);
};

const isSimplePrivateOctet = (first: number): boolean =>
  first === PRIVATE_10_FIRST_OCTET || first === LOOPBACK_FIRST_OCTET
  || first === 0;

const isPrivateLinkLocalIpv4 = (first: number, second: number): boolean =>
  first === LINK_LOCAL_FIRST_OCTET && second === LINK_LOCAL_SECOND_OCTET;

const isPrivate172Ipv4 = (first: number, second: number): boolean =>
  first === PRIVATE_172_FIRST_OCTET && second >= PRIVATE_172_LOW
  && second <= PRIVATE_172_HIGH;

const isPrivate192Ipv4 = (first: number, second: number): boolean =>
  first === PRIVATE_192_FIRST_OCTET && second === PRIVATE_192_SECOND_OCTET;

const privateIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const mapped = IPV4_MAPPED_IPV6.exec(normalized);
  if (mapped?.[1] !== undefined) return privateIpv4(mapped[1]);
  const firstHextet = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) return true; // unparseable — fail closed
  return (firstHextet >= IPV6_UNIQUE_LOCAL_LOW
    && firstHextet <= IPV6_UNIQUE_LOCAL_HIGH)
    || (firstHextet >= IPV6_LINK_LOCAL_LOW
      && firstHextet <= IPV6_LINK_LOCAL_HIGH);
};

// Constant-time string comparison for webhook tokens and signatures, so a
// route never leaks how much of a secret matched through response timing.
export const constantTimeEqual = (
  provided: string,
  expected: string,
): boolean => {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
};

// Shared-token verification for webhook ingress routes: the caller embeds
// `?token=<secret>` in the URL it registers with the remote service.
export const verifiedRequestToken = (
  request: Request,
  secret: string,
): boolean => {
  const provided = new URL(request.url).searchParams.get("token");
  return provided !== null && provided.length > 0
    && constantTimeEqual(provided, secret);
};

export const SIGNATURE_HEADER = "x-elliott-signature";

export const hmacSha256Hex = (secret: string, body: string): string =>
  createHmac("sha256", secret).update(body).digest("hex");

// The internal-hop scheme shared by webhook ingress: the sender signs the raw
// body with the shared secret in x-elliott-signature; consumer routes verify
// it so nothing that can merely reach the runtime port can inject "verified"
// deliveries. Same scheme as skills/gateway/webhook.
export const verifiedSignatureHeader = (
  request: Request,
  body: string,
  secret: string,
): boolean => {
  const provided = request.headers.get(SIGNATURE_HEADER);
  return provided !== null && provided.length > 0
    && constantTimeEqual(provided, hmacSha256Hex(secret, body));
};

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
