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
  return { tools: [describeTool(settings)] };
};

// The tool deliberately returns METADATA ONLY — which fields exist at an
// allowlisted path and whether they are provisioned — never a secret value.
// Tool output is placed verbatim into model context (agent.ts wraps it as
// [UNTRUSTED TOOL OUTPUT]); returning a raw secret there would break the
// opaque-secret invariant (CLAUDE.md: secrets are resolved at the config
// boundary, never handed to the model). Secret VALUES reach the skills that need
// them via `${VAULT:path#field}` config expressions, not through this tool.
const describeTool = (settings: VaultSettings): ToolDefinition => ({
  name: "vault_kv_describe",
  description:
    "Inspect an allowlisted HashiCorp Vault KV v2 path WITHOUT revealing any "
    + "secret value: returns the field names present at the path (JSON "
    + "{path, fields}), or — with an optional `field` — whether that field is "
    + `provisioned (JSON {path, field, present}). Allowed paths: ${
      settings.paths.join(", ")
    }.`
    + " Secret values are resolved at the config boundary and never enter tool "
    + "output or the model context.",
  inputSchema: objectSchema({
    path: { type: "string" },
    field: { type: "string" },
  }, ["path"]),
  execute: (input) => performDescribe(settings, input),
});

const performDescribe = async (
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
  if (field !== undefined) {
    // Presence = the field exists and holds a non-empty value. No value echoed.
    const present = field in data && !isEmptyValue(data[field]);
    return JSON.stringify({ path: requestedPath, field, present });
  }
  const fields = Object.keys(data).sort((a, b) => a.localeCompare(b));
  return JSON.stringify({ path: requestedPath, fields }).slice(
    0,
    MAX_TOOL_OUTPUT_CHARACTERS,
  );
};

const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null
  || (typeof value === "string" && value.length === 0);

const optionalField = (input: unknown): string | undefined =>
  isJsonRecord(input) && typeof input["field"] === "string"
    ? input["field"]
    : undefined;

// KV v2 read: GET <address>/v1/<path> with the token header, returning the
// inner data map (body.data.data). The values are used only to derive metadata
// (field names / presence) and never leave the process. Every failure throws a
// generic error — the token, the address host, and the requested path never
// appear in the message, so nothing sensitive can ride out through a captured
// error payload.
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
