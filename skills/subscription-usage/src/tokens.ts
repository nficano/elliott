import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonRecord } from "../../../src/providers/http";
import type { OauthTokens, TokenStore } from "./types";
import { numberField, stringField } from "./wire";

const STATE_SUBDIRECTORY = "subscription-usage";
const STATE_FILE_MODE = 0o600;

// Rotated tokens are persisted per provider-account under the runtime state
// directory, keyed to the Vault seed's refresh token: re-seeding the secret
// (a fresh login) invalidates the stored chain and the new seed wins.
export const makeTokenStore = (stateDirectory: string): TokenStore => {
  const directory = path.join(stateDirectory, STATE_SUBDIRECTORY);
  const fileFor = (key: string): string => path.join(directory, `${key}.json`);
  return {
    load: async (key, seed) => {
      const stored = await readState(fileFor(key));
      return stored !== undefined && stored.seed === seed.refreshToken
        ? { ...seed, ...stored.tokens }
        : seed;
    },
    save: async (key, seed, tokens) => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        fileFor(key),
        JSON.stringify({ seed: seed.refreshToken, tokens }),
        { mode: STATE_FILE_MODE },
      );
    },
  };
};

const readState = async (
  file: string,
): Promise<
  { readonly seed: string; readonly tokens: OauthTokens; } | undefined
> => {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  if (!isJsonRecord(payload)) return undefined;
  const seed = stringField(payload, "seed");
  const tokens = decodeTokens(payload["tokens"]);
  return seed === undefined || tokens === undefined
    ? undefined
    : { seed, tokens };
};

const decodeTokens = (value: unknown): OauthTokens | undefined => {
  const accessToken = stringField(value, "accessToken");
  const refreshToken = stringField(value, "refreshToken");
  if (accessToken === undefined || refreshToken === undefined) {
    return undefined;
  }
  const expiresAt = numberField(value, "expiresAt");
  const accountId = stringField(value, "accountId");
  return {
    accessToken,
    refreshToken,
    ...(expiresAt !== undefined && { expiresAt }),
    ...(accountId !== undefined && { accountId }),
  };
};

// Seeds accept the JSON the vendors' own tooling writes, so a Vault secret
// can be a verbatim paste: the "Claude Code-credentials" Keychain payload
// ({claudeAiOauth: {...}}) or ~/.codex/auth.json ({tokens: {...}}). Flat
// token objects work too.
export const parseClaudeSeed = (credentials: string): OauthTokens => {
  const record = seedRecord(credentials, "claudeAiOauth");
  const accessToken = stringField(record, "accessToken")
    ?? stringField(record, "access_token");
  const refreshToken = stringField(record, "refreshToken")
    ?? stringField(record, "refresh_token");
  if (accessToken === undefined || refreshToken === undefined) {
    throw new Error("Claude credentials need an access and refresh token");
  }
  const expiresAt = numberField(record, "expiresAt");
  return {
    accessToken,
    refreshToken,
    ...(expiresAt !== undefined && { expiresAt }),
  };
};

export const parseCodexSeed = (credentials: string): OauthTokens => {
  const record = seedRecord(credentials, "tokens");
  const accessToken = stringField(record, "access_token")
    ?? stringField(record, "accessToken");
  const refreshToken = stringField(record, "refresh_token")
    ?? stringField(record, "refreshToken");
  if (accessToken === undefined || refreshToken === undefined) {
    throw new Error("Codex credentials need an access and refresh token");
  }
  const accountId = stringField(record, "account_id")
    ?? stringField(record, "accountId");
  return {
    accessToken,
    refreshToken,
    ...(accountId !== undefined && { accountId }),
  };
};

const seedRecord = (credentials: string, wrapper: string): unknown => {
  let payload: unknown;
  try {
    payload = JSON.parse(credentials);
  } catch {
    throw new Error("Account credentials are not valid JSON");
  }
  if (!isJsonRecord(payload)) {
    throw new Error("Account credentials must be a JSON object");
  }
  return isJsonRecord(payload[wrapper]) ? payload[wrapper] : payload;
};
