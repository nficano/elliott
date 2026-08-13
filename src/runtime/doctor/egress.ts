import type { DoctorEgressTrace } from "./types";

// The host a fetch input names, or undefined when it cannot be parsed as a URL.
// Covers the three shapes Bun's fetch accepts: string, URL, and Request.
const hrefOf = (input: unknown): string | undefined => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return undefined;
};

const fetchHost = (input: unknown): string | undefined => {
  const href = hrefOf(input);
  if (href === undefined) return undefined;
  try {
    return new URL(href).host;
  } catch {
    return undefined;
  }
};

// Run `fn` with globalThis.fetch replaced by a guard that permits requests only
// to the allowlisted hosts (the LLM endpoint). Every contacted host is recorded;
// a request to any other host is both recorded as a violation AND thrown from
// that fetch call, so the offending code path fails loudly instead of silently
// reaching off-box. The original fetch is always restored.
export const withEgressAllowlist = async <T>(
  allowedHosts: readonly string[],
  fn: () => Promise<T>,
): Promise<DoctorEgressTrace<T>> => {
  const contacted = new Set<string>();
  const violations = new Set<string>();
  const original = globalThis.fetch;
  const guarded = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const host = fetchHost(input);
    if (host !== undefined) {
      contacted.add(host);
      if (!allowedHosts.includes(host)) {
        violations.add(host);
        throw new Error(
          `egress blocked: ${host} is outside the LLM-only allowlist `
            + `(permitted: ${allowedHosts.join(", ")})`,
        );
      }
    }
    return original(input, init);
  };
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
