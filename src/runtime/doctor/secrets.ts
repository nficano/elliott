// Which values in a settings object are secrets is derived from the object's
// own shape, never hand-listed at a call site. A string is a secret when its
// key names one — the vocabulary the config boundary uses for credential
// fields: an API key, a token, a secret, a password/passphrase, a private key,
// a credential, or a DSN (which carries embedded auth). This is deliberately a
// property of the KEY, not a blocklist of VALUES, so a field added later —
// `stripeToken`, `webhookSecret`, a nested `clientSecret` — is redacted the day
// it exists, with no one remembering to register it. Non-secret config
// (`provider`, `model`, `host`, `baseUrl`, an id) never matches, so a plain
// configuration error still prints its real value.
//
// Bare "key" is intentionally excluded (it would swallow `keywords`); the
// compound forms `apiKey`/`api_key` and `privateKey`/`private_key` cover every
// real key field and match camelCase case-insensitively.
const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|private[_-]?key|token|secret|password|passphrase|credential|dsn)/i;

const isSecretKey = (key: string): boolean => SECRET_KEY_PATTERN.test(key);

// Walk any value and collect every non-empty string that sits under a
// secret-named key, recursing through nested objects and arrays so nested
// credentials (a gateway's `botToken`, an account's `clientSecret`) are caught
// too. Works on RuntimeSettings and on the doctor's env overlay alike.
export const secretValuesOf = (value: unknown): readonly string[] => {
  const found: string[] = [];
  const walk = (node: unknown, key: string | undefined): void => {
    if (typeof node === "string") {
      if (key !== undefined && node.length > 0 && isSecretKey(key)) {
        found.push(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [childKey, childValue] of Object.entries(node)) {
        walk(childValue, childKey);
      }
    }
  };
  walk(value, undefined);
  return found;
};
