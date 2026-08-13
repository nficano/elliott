const REDACTION = "‹redacted›";
// Shorter strings are too generic to redact safely (an empty or 2-char key
// would blank out unrelated text); real API keys are far longer.
const MIN_SECRET_LENGTH = 8;
const CONTROL_MAX = 0x1F;
const DELETE_CODE = 0x7F;

// A single-line, human-readable message for an unknown thrown value. Uses only
// the Error's `message` — never its stack — so a surfaced failure names the
// problem without dumping a raw trace at the operator.
export const cleanMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Replace every occurrence of a known secret with a fixed marker. The probe and
// the config loader feed provider- and environment-derived text into
// operator-facing output; a hostile or misconfigured endpoint can echo the
// Authorization header back in its error body, so the API key is scrubbed
// before the text is ever printed or captured.
export const redactSecrets = (
  text: string,
  secrets: readonly (string | undefined)[],
): string => {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= MIN_SECRET_LENGTH) {
      out = out.split(secret).join(REDACTION);
    }
  }
  return out;
};

const isControl = (code: number): boolean =>
  code <= CONTROL_MAX || code === DELETE_CODE;

// Collapse control characters — newlines, carriage returns, tabs, terminal
// escape bytes — to single spaces so untrusted content (a provider error body)
// cannot forge report lines (a fake `VERDICT: PASS`) or emit terminal escape
// sequences into a log. Runs of whitespace collapse to one space.
export const oneLine = (text: string): string => {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    out += isControl(code) ? " " : character;
  }
  return out.replaceAll(/ {2,}/g, " ").trim();
};

// The full display sanitizer: scrub secrets, then flatten to a single line.
export const sanitizeForDisplay = (
  text: string,
  secrets: readonly (string | undefined)[] = [],
): string => oneLine(redactSecrets(text, secrets));
