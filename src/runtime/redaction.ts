// Strips secret material out of any text that leaves the process — console
// lines and captured error payloads alike. The runtime error reporter is the
// single chokepoint every captured failure passes through, so redaction lives
// there (see reporter.ts). This upholds the CLAUDE.md doctrine — never log or
// transmit a secret — even when an upstream caller interpolates one into an
// exception message the reporter merely relays.
//
// Two layers:
//   - shape patterns (`redactPatterns`): credential-shaped substrings — Vault
//     token prefixes, common API-key prefixes (sk-…, xox…, gh…), and URL
//     userinfo (a DSN's public key, any user:pass@host) — stripped even when the
//     exact value was not known ahead of time. Self-contained, so a sink can
//     apply it without configuration.
//   - exact literals (`makeRedactor`): the resolved secret VALUES the config
//     boundary knows (every configured token/secret/key/DSN plus Vault paths),
//     collected by `collectSecretStrings`, stripped by value so a secret rides
//     out neither when it is credential-shaped nor when it is not.

const REDACTED = "[redacted]";

const SECRET_PATTERNS: readonly RegExp[] = [
  // HashiCorp Vault tokens: service (hvs.), batch (hvb.), recovery (hvr.).
  /\bhv[sbr]\.[A-Za-z0-9._-]+/g,
  // Legacy Vault service tokens (s.<24+ chars>); length-gated to avoid eating
  // ordinary "s." prose.
  /\bs\.[A-Za-z0-9]{20,}/g,
  // OpenAI/Anthropic-style secret keys (sk-, sk-ant-, sk-proj-, sk-live-, …).
  /\bsk-[A-Za-z0-9-]{8,}/g,
  // Slack tokens (xoxb-/xoxp-/xoxa-/xoxr-/xoxs-) and GitHub tokens (ghp_/gho_
  // /ghs_/ghr_/github_pat_).
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bgh[opsru]_[A-Za-z0-9]{16,}/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // URL userinfo — a DSN's public key, or any scheme://user[:pass]@host.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S*/gi,
];

// Field-name substrings that mark a value a secret. Matched against the key with
// its separators removed and lower-cased (`api_key`/`api-key` -> `apikey`;
// `refresh_token` -> `refreshtoken`), so snake_case, kebab-case, and camelCase
// all qualify — appToken/clientSecret/refreshToken/webhookSecret/privateKey/
// llmApiKey/api_key/postgresDsn/authorization/credentials do; hostnames, URLs,
// model names, and allowlists (host/url/model/paths/…) do not.
const SECRET_KEY_PATTERN =
  /token|secret|password|passphrase|privatekey|apikey|dsn|authorization|credential/;

const isSecretKey = (key: string): boolean =>
  SECRET_KEY_PATTERN.test(key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase());

// Every string reachable from a node (through nested objects and arrays alike).
// Once a key is judged a secret, its ENTIRE value is sensitive — a single string,
// an array of strings (`api_keys: [...]`), or a nested credentials object — so
// all of it is collected, not just an immediate string child.
const pushAllStrings = (node: unknown, into: string[]): void => {
  if (typeof node === "string") {
    into.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) pushAllStrings(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const child of Object.values(node)) pushAllStrings(child, into);
};

// Walk an arbitrary resolved-settings object and collect every string reachable
// from a secret-named key. Used to seed the reporter's redactor with EVERY
// configured secret value — not just the DSN/Vault ones — so a credential (an
// LLM key, a Slack token, an SSH key, a webhook secret, an agent-skill
// `api_key`, or an array of keys) echoed into an error message is stripped
// before it leaves the process. New secret settings are covered automatically as
// long as their field name follows the convention.
export const collectSecretStrings = (value: unknown): readonly string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (isSecretKey(key)) {
        pushAllStrings(child, found);
      } else {
        walk(child);
      }
    }
  };
  walk(value);
  return found;
};

export const redactPatterns = (text: string): string => {
  let out = text;
  // A function replacement avoids `$`-pattern interpretation in the token.
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => REDACTED);
  }
  return out;
};

// Build a redactor that removes the given exact secret values (longest first, so
// a token that contains a shorter secret as a substring is removed whole) and
// then applies the shape patterns. Every non-empty configured secret is redacted
// regardless of length — a short secret is still a secret. Only values that are
// empty or all-whitespace are dropped: they are never real secrets, and redacting
// "" (or " ") would shred every message. A pathological short secret may over-
// redact ordinary text, but over-redaction never leaks.
export const makeRedactor = (
  secrets: readonly string[],
): (text: string) => string => {
  const literals = [
    ...new Set(secrets.filter((secret) => secret.trim().length > 0)),
  ].sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const literal of literals) out = out.split(literal).join(REDACTED);
    return redactPatterns(out);
  };
};
