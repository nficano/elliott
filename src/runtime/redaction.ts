// Strips secret material out of any text that leaves the process — console
// lines and captured error payloads alike. The runtime error reporter is the
// single chokepoint every captured failure passes through, so redaction lives
// there (see reporter.ts). This upholds the CLAUDE.md doctrine — never log or
// transmit a secret — even when an upstream caller interpolates one into an
// exception message the reporter merely relays.
//
// Two layers:
//   - shape patterns (`redactPatterns`): credential-shaped substrings — Vault
//     token prefixes and URL userinfo (a Sentry/GlitchTip DSN's public key, any
//     user:pass@host) — stripped even when the exact value was not known ahead
//     of time. Self-contained, so a sink can apply it without configuration.
//   - exact literals (`makeRedactor`): the resolved secret VALUES known at the
//     config boundary (the GlitchTip DSN, the Vault token, allowlisted Vault
//     paths) stripped by value, so a configured path or token cannot ride out
//     even though it is not credential-shaped.

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
  // URL userinfo — a DSN's public key, or any scheme://user[:pass]@host.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S*/gi,
];

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
