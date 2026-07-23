/**
 * Encode a value before passing it through PgClient.json. The pg driver
 * serializes objects itself, but primitive strings otherwise reach a jsonb
 * column without JSON quotes.
 */
export function encodeJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (!encoded) {
    throw new TypeError("cannot encode undefined as JSON");
  }
  return encoded;
}
