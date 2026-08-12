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
// Below this length a "secret" is too short to strip without shredding the
// surrounding message (a 1-2 char value would match everywhere).
const MINIMUM_SECRET_LENGTH = 4;

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

// Field names whose string value is a secret. Matched case-insensitively as a
// substring, so appToken/clientSecret/refreshToken/webhookSecret/privateKey/
// llmApiKey/postgresDsn/authorization/credentials all qualify, while hostnames,
// URLs, model names, and allowlists (host/url/model/paths/…) do not.
const SECRET_KEY_PATTERN =
  /token|secret|password|passphrase|privatekey|apikey|dsn|authorization|credential/i;

// Walk an arbitrary resolved-settings object and collect every string whose
// field name marks it a secret. Used to seed the reporter's redactor with EVERY
// configured secret value — not just the DSN/Vault ones — so a credential (an
// LLM key, a Slack token, an SSH key, a webhook secret) echoed into an error
// message is stripped before it leaves the process. New secret settings are
// covered automatically as long as their field name follows the convention.
export const collectSecretStrings = (value: unknown): readonly string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === "string") {
        if (SECRET_KEY_PATTERN.test(key)) found.push(child);
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

// Build a redactor that removes the given exact secret values (longest first,
// so a token that contains a shorter secret as a substring is removed whole)
// and then applies the shape patterns. Too-short values are ignored — redacting
// a 1-2 char "secret" would shred the surrounding message.
export const makeRedactor = (
  secrets: readonly string[],
): (text: string) => string => {
  const literals = [
    ...new Set(
      secrets.filter((secret) => secret.length >= MINIMUM_SECRET_LENGTH),
    ),
  ].sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const literal of literals) out = out.split(literal).join(REDACTED);
    return redactPatterns(out);
  };
};
