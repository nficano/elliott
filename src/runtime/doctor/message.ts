// A single-line, human-readable message for an unknown thrown value. Uses only
// the Error's `message` — never its stack — so a surfaced failure names the
// problem without dumping a raw trace at the operator.
export const cleanMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
