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

// Replace every occurrence of a known secret with a fixed marker. Secrets are
// applied LONGEST first (and de-duplicated), so a recorded secret that is a
// prefix of another cannot replace the prefix and leave the longer secret's
// tail exposed. Any non-empty secret is redacted regardless of length — the
// config boundary accepts short keys, so a length floor would leave a short key
// exposed; over-redacting a pathologically short secret is a readability cost,
// never a leak.
export const redactSecrets = (
  text: string,
  secrets: readonly (string | undefined)[],
): string => {
  const distinct = [
    ...new Set(
      secrets.filter((s): s is string => s !== undefined && s.length > 0),
    ),
  ].sort((left, right) => right.length - left.length);
  let out = text;
  for (const secret of distinct) out = out.split(secret).join(REDACTION);
  return out;
};

// The first line of a message, without a trailing newline. Used to strip a
// parser's multi-line source excerpt (which can quote a file's secret) down to
// its single-line description before display.
export const firstLine = (text: string): string => {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
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
