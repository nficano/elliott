import type { DoctorEgressTrace, DoctorHop } from "./types";

// The URL a fetch input names, or undefined when it cannot be parsed. Covers the
// three shapes Bun's fetch accepts: string, URL, and Request.
const hrefOf = (input: unknown): string | undefined => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return undefined;
};

const safeUrl = (href: string): URL | undefined => {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
};

// Redirect status codes fetch would otherwise follow silently. The guard
// intercepts them so every hop's host is checked, not just the first URL.
const HTTP_MOVED_PERMANENTLY = 301;
const HTTP_FOUND = 302;
const HTTP_SEE_OTHER = 303;
const HTTP_TEMPORARY_REDIRECT = 307;
const HTTP_PERMANENT_REDIRECT = 308;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  HTTP_MOVED_PERMANENTLY,
  HTTP_FOUND,
  HTTP_SEE_OTHER,
  HTTP_TEMPORARY_REDIRECT,
  HTTP_PERMANENT_REDIRECT,
]);
const MAX_REDIRECTS = 5;

// Per the fetch redirect rules, 303 always demotes to GET, and 301/302 demote a
// POST to GET; 307/308 preserve the method and body.
const demotesToGet = (status: number, method: string): boolean =>
  status === HTTP_SEE_OTHER
  || ((status === HTTP_MOVED_PERMANENTLY || status === HTTP_FOUND)
    && method === "POST");

const hopMethod = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): string => {
  if (init?.method !== undefined) return init.method;
  if (input instanceof Request) return input.method;
  return "GET";
};

const hopHeaders = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Headers => {
  if (init?.headers !== undefined) return new Headers(init.headers);
  if (input instanceof Request) return new Headers(input.headers);
  return new Headers();
};

const initialHop = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  href: string,
): DoctorHop => ({
  url: href,
  method: hopMethod(input, init),
  headers: hopHeaders(input, init),
  body: init?.body ?? undefined,
});

const advance = (
  hop: DoctorHop,
  status: number,
  location: string,
): DoctorHop => {
  const url = new URL(location, hop.url).href;
  if (!demotesToGet(status, hop.method)) return { ...hop, url };
  const headers = new Headers(hop.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return { url, method: "GET", headers, body: undefined };
};

// Issue one request, following redirects by hand so every hop passes the
// caller's `checkHop` before it is fetched. checkHop enforces the ORIGIN
// allowlist (scheme + host + port), so — for the initial request and every
// redirect target alike — a plaintext http hop to an https LLM host, a bounce
// to a third host, and a same-host scheme/port downgrade are all rejected
// before any request (and the Authorization header it carries) leaves.
const followGuarded = async (
  guard: {
    readonly original: typeof fetch;
    readonly checkHop: (url: string) => void;
  },
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const href = hrefOf(input);
  // An input we cannot parse as a URL has no origin to check; refuse to follow
  // any redirect for it rather than risk a silent off-box hop.
  if (href === undefined) {
    return guard.original(input, { ...init, redirect: "error" });
  }
  let hop = initialHop(input, init, href);
  guard.checkHop(hop.url);
  for (let redirects = 0;; redirects++) {
    const response = await guard.original(hop.url, {
      ...init,
      method: hop.method,
      headers: hop.headers,
      body: hop.body,
      redirect: "manual",
    });
    const location = REDIRECT_STATUSES.has(response.status)
      ? response.headers.get("location")
      : null;
    if (location === null || location.length === 0) return response;
    if (redirects >= MAX_REDIRECTS) {
      throw new Error(
        `egress blocked: too many redirects (> ${MAX_REDIRECTS}) from ${href}`,
      );
    }
    hop = advance(hop, response.status, location);
    guard.checkHop(hop.url);
  }
};

// Run `fn` with globalThis.fetch replaced by a guard that permits requests only
// to the allowlisted ORIGINS (the LLM endpoint's scheme://host:port). Every
// contacted host — including every redirect target — is recorded; a request to
// any other origin is recorded as a violation AND thrown, so the offending path
// fails loudly instead of reaching off-box. The original fetch is always
// restored.
export const withEgressAllowlist = async <T>(
  allowedOrigins: readonly string[],
  fn: () => Promise<T>,
): Promise<DoctorEgressTrace<T>> => {
  const contacted = new Set<string>();
  const violations = new Set<string>();
  const original = globalThis.fetch;
  // Validate one hop by ORIGIN, not host: an https LLM endpoint's origin does
  // not admit http://<same-host> (different scheme, and default port 80 vs 443),
  // a different host, or a different port. Records the host for the report; a
  // mismatch is recorded as a violation and thrown.
  const checkHop = (url: string): void => {
    const target = safeUrl(url);
    if (target === undefined) return;
    contacted.add(target.host);
    if (!allowedOrigins.includes(target.origin)) {
      violations.add(target.host);
      throw new Error(
        `egress blocked: ${target.origin} is outside the LLM-only allowlist `
          + `(permitted: ${allowedOrigins.join(", ")})`,
      );
    }
  };
  const guarded = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => followGuarded({ original, checkHop }, input, init);
  // Swapping the global fetch is the whole mechanism: it scopes an egress
  // allowlist over `fn` without threading a fetch argument through the model
  // client and every skill. Preserve fetch.preconnect so the swapped global
  // stays shape-compatible, and always restore the original in `finally`.
  // eslint-disable-next-line unicorn/no-global-object-property-assignment
  globalThis.fetch = Object.assign(guarded, {
    preconnect: original.preconnect,
  });
  try {
    const result = await fn();
    return {
      result,
      contactedHosts: [...contacted],
      violations: [...violations],
    };
  } finally {
    // eslint-disable-next-line unicorn/no-global-object-property-assignment
    globalThis.fetch = original;
  }
};

// The origin (scheme://host:port) of a base URL, used to seed the allowlist
// from settings so egress is pinned to the exact LLM endpoint, scheme included.
export const originOf = (baseUrl: string): string => new URL(baseUrl).origin;
