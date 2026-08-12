import { isJsonRecord } from "../../../src/providers/http";
import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  requiredString,
} from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { ToolDefinition, VaultSettings } from "../../../src/runtime/types";

const READ_TIMEOUT_MILLISECONDS = 15_000;
const VAULT_TOKEN_HEADER = "x-vault-token";

// HashiCorp Vault, off unless explicitly enabled. Self-gates on settings.vault:
// the config loader only populates it when the flag, address, token, AND a
// non-empty path allowlist are all present (fail closed). A disabled deployment
// registers nothing.
export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.vault;
  if (settings === undefined) return {};
  return { tools: [readTool(settings)] };
};

const readTool = (settings: VaultSettings): ToolDefinition => ({
  name: "vault_kv_read",
  description:
    "Read a secret from an allowlisted HashiCorp Vault KV v2 path. Allowed "
    + `paths: ${settings.paths.join(", ")}. Pass an optional field to read one `
    + "key; otherwise every key at the path is returned. Values are sensitive.",
  inputSchema: objectSchema({
    path: { type: "string" },
    field: { type: "string" },
  }, ["path"]),
  execute: (input) => performRead(settings, input),
});

const performRead = async (
  settings: VaultSettings,
  input: unknown,
): Promise<string> => {
  const requestedPath = requiredString(input, "path");
  if (!settings.paths.includes(requestedPath)) {
    // Fail closed WITHOUT echoing the path: a denial that leaves the process
    // (logs, captured error payloads) must not disclose what was requested.
    throw new Error("Requested path is not on the Vault allowlist");
  }
  const data = await read(settings, requestedPath);
  const field = optionalField(input);
  if (field === undefined) {
    return JSON.stringify(data).slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
  }
  if (!(field in data)) {
    throw new Error("Requested field is absent at the Vault path");
  }
  const value = data[field];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
};

const optionalField = (input: unknown): string | undefined =>
  isJsonRecord(input) && typeof input["field"] === "string"
    ? input["field"]
    : undefined;

// KV v2 read: GET <address>/v1/<path> with the token header, returning the
// inner data map (body.data.data). Every failure throws a generic error — the
// token, the address host, and the requested path never appear in the message,
// so nothing sensitive can ride out through a captured error payload.
const read = async (
  settings: VaultSettings,
  secretPath: string,
): Promise<Readonly<Record<string, unknown>>> => {
  let response: Response;
  try {
    response = await fetch(`${settings.address}/v1/${secretPath}`, {
      headers: { [VAULT_TOKEN_HEADER]: settings.token },
      signal: AbortSignal.timeout(READ_TIMEOUT_MILLISECONDS),
      redirect: "error",
    });
  } catch {
    throw new Error("Vault request failed");
  }
  if (!response.ok) {
    throw new Error(`Vault returned HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  const outer = isJsonRecord(body) ? body["data"] : undefined;
  const inner = isJsonRecord(outer) ? outer["data"] : undefined;
  if (!isJsonRecord(inner)) {
    throw new Error("Vault response did not contain KV data");
  }
  return inner;
};
