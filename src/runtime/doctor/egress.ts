import type { DoctorEgressTrace, DoctorHop } from "./types";

// The URL a fetch input names, or undefined when it cannot be parsed. Covers the
// three shapes Bun's fetch accepts: string, URL, and Request.
const hrefOf = (input: unknown): string | undefined => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return undefined;
};

const hostOfUrl = (href: string): string | undefined => {
  try {
    return new URL(href).host;
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

// Issue one request, following redirects by hand so every hop's host passes the
// caller's `checkHost` (which records it and throws on a non-allowlisted host).
// This closes the gap where fetch would auto-follow an allowlisted endpoint's
// redirect to a third host without the guard ever seeing it.
const followGuarded = async (
  guard: {
    readonly original: typeof fetch;
    readonly checkHost: (href: string) => void;
  },
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const href = hrefOf(input);
  // An input we cannot parse as a URL has no host to check; refuse to follow
  // any redirect for it rather than risk a silent off-box hop.
  if (href === undefined) {
    return guard.original(input, { ...init, redirect: "error" });
  }
  let hop = initialHop(input, init, href);
  for (let redirects = 0;; redirects++) {
    guard.checkHost(hop.url);
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
  }
};

// Run `fn` with globalThis.fetch replaced by a guard that permits requests only
// to the allowlisted hosts (the LLM endpoint). Every contacted host — including
// every redirect target — is recorded; a request to any other host is recorded
// as a violation AND thrown, so the offending path fails loudly instead of
// reaching off-box. The original fetch is always restored.
export const withEgressAllowlist = async <T>(
  allowedHosts: readonly string[],
  fn: () => Promise<T>,
): Promise<DoctorEgressTrace<T>> => {
  const contacted = new Set<string>();
  const violations = new Set<string>();
  const original = globalThis.fetch;
  const checkHost = (href: string): void => {
    const host = hostOfUrl(href);
    if (host === undefined) return;
    contacted.add(host);
    if (!allowedHosts.includes(host)) {
      violations.add(host);
      throw new Error(
        `egress blocked: ${host} is outside the LLM-only allowlist `
          + `(permitted: ${allowedHosts.join(", ")})`,
      );
    }
  };
  const guarded = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => followGuarded({ original, checkHost }, input, init);
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

// The host portion of a base URL, used to seed the allowlist from settings.
export const hostOf = (baseUrl: string): string => new URL(baseUrl).host;
