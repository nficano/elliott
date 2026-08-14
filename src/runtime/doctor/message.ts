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
// redacts is the recording resolver's captured set, which holds only resolved
// SECRETS — the non-secret LLM configuration variables are skip-listed before
// recording (see recordingResolver). So a short recorded value (a PIN, a
// three-character token, a brief passphrase) is a real credential the config
// boundary accepted and must be scrubbed regardless of length; the length of a
// secret is not a licence to print it. Only a value whose trimmed length is zero
// is skipped, because there is nothing to replace and an empty match would hit
// everywhere. This is the addendum's "meaningless replacement" rule read by its
// cause — nothing to replace — not by a length threshold on real secrets.
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

// Strip the userinfo (`user:pass@`) from every URL embedded in a string. A
// resolved endpoint can carry credentials inline that no recorded secret matches
// — the LLM base_url is non-secret by NAME, so it is never in the redaction set,
// yet its value may embed a password. Dropping the userinfo component is a
// structural fact this process derives from the URL grammar, so it holds for any
// inline credential rather than a specific run of bytes. It runs over free text
// (a skill's error message, a config error), not just a bare URL, so an endpoint
// quoted inside a longer message is covered too.
// Scheme is bounded (URL schemes are short) so the match is linear — no
// catastrophic backtracking on a long run of scheme-legal characters that never
// reaches `://`.
const URL_WITH_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/)[^/?#\s@]+@/g;
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
