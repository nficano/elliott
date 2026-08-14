const REDACTION = "‹redacted›";

// Everything that is a control character, an invisible format character, or a
// line/paragraph separator — matched by Unicode category, not a hand-listed set
// of code points, so C1 controls and Unicode line separators (U+0085, U+2028,
// U+2029) are covered as completely as C0 and DEL. Flattening these is what
// stops attacker-influenced text from forging a new line or emitting terminal
// escapes.
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const WHITESPACE_RUN = /\s+/gu;

// A single-line, human-readable message for an unknown thrown value. Uses only
// the Error's `message` — never its stack — so a surfaced failure names the
// problem without dumping a raw trace at the operator.
export const cleanMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// A value is redacted when it has any non-whitespace content. The set the doctor
// redacts holds only resolved SECRETS — the config boundary records a value only
// when it fills a secret-bearing field (see loadRuntimeSettings' onSecret sink),
// so a non-secret reference (a provider, a model, a timezone) is never in it. A
// short recorded value (a PIN, a three-character token, a brief passphrase) is
// therefore a real credential and must be scrubbed regardless of length; the
// length of a secret is not a licence to print it. Only a value whose trimmed
// length is zero is skipped, because there is nothing to replace and an empty
// match would hit everywhere. This is the addendum's "meaningless replacement"
// rule read by its cause — nothing to replace — not a length threshold on secrets.
const redactable = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

// Replace every occurrence of a known secret with a fixed marker. Secrets are
// applied LONGEST first (and de-duplicated), so a recorded secret that is a
// prefix of another cannot replace the prefix and leave the longer secret's
// tail exposed.
export const redactSecrets = (
  text: string,
  secrets: readonly (string | undefined)[],
): string => {
  const distinct = [...new Set(secrets.filter(redactable))]
    .sort((left, right) => right.length - left.length);
  let out = text;
  for (const secret of distinct) out = out.split(secret).join(REDACTION);
  return out;
};

// Drop a parser's multi-line source excerpt, which sits below a BLANK line and
// can quote a file's bytes. Truncating at the blank line (not the first newline)
// keeps a description intact and, crucially, does not chop a message whose only
// newline is inside an interpolated value — that is left whole for the caller to
// flatten, so a value is never truncated to a misleading prefix.
export const dropCodeFrame = (text: string): string => {
  const blank = /\r?\n[ \t]*\r?\n/.exec(text);
  return blank === null ? text : text.slice(0, blank.index);
};

// Collapse every control, format, and line/paragraph-separator character to a
// space so untrusted content cannot forge report lines (a fake `VERDICT: PASS`)
// or emit terminal escape sequences into a log, then collapse whitespace runs.
export const oneLine = (text: string): string =>
  text.replaceAll(UNSAFE_CHARACTERS, " ").replaceAll(WHITESPACE_RUN, " ")
    .trim();

// Make an already-built, indented report line injection-safe: replace only the
// line-forging characters (controls, formats, line/paragraph separators, which
// include every newline) with a space, WITHOUT collapsing runs or trimming, so
// the line keeps its own leading indentation. This is the formatter's single
// chokepoint — applied to every emitted line, it stops ANY interpolated value
// (a skill name, a gate text, a manifest secret reference) from carrying a
// newline that forges a standalone line, without each call site having to
// remember to flatten. `oneLine` compacts a value to a token; this only defuses
// injection while preserving layout.
export const flattenLine = (line: string): string =>
  line.replaceAll(UNSAFE_CHARACTERS, " ");

// Strip the userinfo (`user:pass@`) from every URL embedded in a string. A
// resolved endpoint can carry credentials inline that no recorded secret matches
// — the LLM base_url is non-secret by NAME, so it is never in the redaction set,
// yet its value may embed a password. Dropping the userinfo component is a
// structural fact this process derives from the URL grammar, so it holds for any
// inline credential rather than a specific run of bytes. It runs over free text
// (a skill's error message, a config error), not just a bare URL, so an endpoint
// quoted inside a longer message is covered too.
// Userinfo is everything between `://` and the LAST `@` of the authority — that
// is the delimiter URL parsing uses, so a password may itself contain `@`. The
// character class stops at the authority's end (`/`, `?`, `#`, or whitespace) and
// the greedy `*` then backtracks to the final `@`, matching the whole userinfo
// including embedded `@`. Scheme is bounded (schemes are short) so the match stays
// linear — no catastrophic backtracking on a long run that never reaches `://`.
const URL_WITH_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/)[^/?#\s]*@/g;
export const stripUrlUserinfo = (text: string): string =>
  text.replaceAll(URL_WITH_USERINFO, "$1");

// The full display sanitizer: scrub recorded secrets, strip any inline URL
// credential no recorded secret would match, then flatten to a single line. Every
// operator-facing string that may carry attacker- or config-influenced content
// goes through here, so the three defenses are applied uniformly, not per site.
export const sanitizeForDisplay = (
  text: string,
  secrets: readonly (string | undefined)[] = [],
): string => oneLine(stripUrlUserinfo(redactSecrets(text, secrets)));
