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

// A value shorter than this (after trimming) is not redacted: replacing a one-
// or two-character value would blank a substring of ordinary words (redacting
// "k" mangles "Unknown"), and no real credential — an API key, a token, a DSN —
// is that short. This is the addendum's "meaningless replacement" rule: the
// trigger is length making the replacement meaningless, not the value's secrecy.
const MIN_REDACTABLE_LENGTH = 4;

const redactable = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length >= MIN_REDACTABLE_LENGTH;

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

// Drop any userinfo (`user:password@`) from a URL before it is printed, so a
// resolved endpoint that carries inline credentials shows only its safe part.
// A value that does not parse as a URL is returned unchanged (the caller still
// runs it through sanitizeForDisplay).
export const stripUrlUserinfo = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return url;
  }
};

// The full display sanitizer: scrub secrets, then flatten to a single line.
export const sanitizeForDisplay = (
  text: string,
  secrets: readonly (string | undefined)[] = [],
): string => oneLine(redactSecrets(text, secrets));
