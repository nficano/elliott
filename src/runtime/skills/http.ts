import { createHmac, timingSafeEqual } from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { isJsonRecord } from "../../providers/http";
import { isPrivateAddress } from "./ip-guard";
import type { AddressResolver, ValidatedDestination } from "./types";

export const MAX_TOOL_OUTPUT_CHARACTERS = 12_000;

const REQUEST_TIMEOUT_MILLISECONDS = 30_000;

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

const IP_FAMILY_V6 = 6;

// A hostname string can never prove a destination is public — an attacker
// picks the name, and DNS is what decides where it actually goes (nip.io,
// sslip.io, and plain DNS rebinding all resolve an innocuous-looking name to
// a private address). So this resolves the name and validates every address
// it answers to, not just the text of the name itself. `resolve` defaults to
// a real DNS lookup; tests inject a fake one to stay offline and
// deterministic. Shared by publicUrl (validate only) and fetchPublicUrl
// (validate, then connect to the exact address just validated).
const validatedDestination = async (
  value: string,
  resolve: AddressResolver,
): Promise<ValidatedDestination> => {
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
  // Reject if ANY resolved answer is private, not just the one we go on to
  // pin below — a multi-answer response mixing a public and a private
  // address is exactly the shape a rebinding attempt with a decoy public
  // answer would take.
  if (addresses.some(isPrivateAddress) || addresses[0] === undefined) {
    throw new Error(
      `Destination ${url.hostname} is outside the public egress grant`,
    );
  }
  return { url, hostname, address: addresses[0] };
};

export const publicUrl = async (
  value: string,
  resolve: AddressResolver = defaultResolver,
): Promise<URL> => (await validatedDestination(value, resolve)).url;

// Performs the actual network request pinned to the exact address that was
// just validated. publicUrl() followed by a separate, later fetch() would
// resolve DNS a second time — with a TTL-0 answer under attacker control,
// that second lookup can return a different (private or metadata) address
// than the one that was checked, defeating the check entirely. Pinning the
// connection to the validated address in the same step closes that gap:
// the address that gets checked is the address that gets connected to.
// The original hostname is preserved as the Host header and, for HTTPS, the
// TLS SNI name, so a virtual-hosted or CDN-fronted destination still routes
// to the right site and its certificate still validates against the name
// the caller actually asked for, not the pinned IP literal. Returns the raw
// Response — does not throw on a non-2xx status, so callers that need to
// inspect status or retry (gateway-gmail's POST-then-GET unsubscribe flow)
// can do so; requestPublicUrl below adds the throw-on-!ok convenience.
export const fetchPublicUrl = async (
  value: string,
  init: Readonly<{
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Bun.BodyInit;
  }> = {},
  resolve: AddressResolver = defaultResolver,
): Promise<Response> => {
  const { url, hostname, address } = await validatedDestination(
    value,
    resolve,
  );
  const pinned = new URL(url);
  pinned.hostname = isIP(address) === IP_FAMILY_V6 ? `[${address}]` : address;
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  return fetch(pinned, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    ...(init.body !== undefined && { body: init.body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    redirect: "error",
    ...(url.protocol === "https:" && { tls: { servername: hostname } }),
  });
};

export const requestPublicUrl = async (
  value: string,
  init: Readonly<{
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Bun.BodyInit;
  }> = {},
  resolve: AddressResolver = defaultResolver,
): Promise<Response> => {
  const response = await fetchPublicUrl(value, init, resolve);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(value).host}`);
  }
  return response;
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
