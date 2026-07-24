import { isJsonRecord } from "../providers/http";
import type {
  BlueBubblesSettings,
  GmailSettings,
  McpEndpointSettings,
  SlackSettings,
} from "./types";

export const valueAt = (value: unknown, keys: readonly string[]): unknown => {
  let current = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

export const stringAt = (value: unknown, keys: readonly string[]): string => {
  const result = valueAt(value, keys);
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(`Missing configuration: ${keys.join(".")}`);
  }
  return result;
};

export const optionalStringAt = (
  value: unknown,
  keys: readonly string[],
): string | undefined => {
  const result = valueAt(value, keys);
  return typeof result === "string" && result.length > 0 ? result : undefined;
};

export const optionalNumberAt = (
  value: unknown,
  keys: readonly string[],
): number | undefined => {
  const result = valueAt(value, keys);
  return typeof result === "number" ? result : undefined;
};

export const stringArrayAt = (
  value: unknown,
  keys: readonly string[],
): readonly string[] => {
  const result = valueAt(value, keys);
  return Array.isArray(result)
    ? result.filter((item): item is string => typeof item === "string")
    : [];
};

export const optionalSlack = (
  value: unknown,
): { readonly slack?: SlackSettings; } => {
  if (valueAt(value, ["channels", "slack", "enabled"]) !== true) return {};
  return {
    slack: {
      appToken: stringAt(value, ["channels", "slack", "app_token"]),
      botToken: stringAt(value, ["channels", "slack", "bot_token"]),
      ...optionalStringProperty("userToken", value, [
        "channels",
        "slack",
        "user_token",
      ]),
      ownerId: stringAt(value, ["channels", "slack", "owner_id"]),
      defaultChannel: stringAt(value, [
        "channels",
        "slack",
        "default_channel",
      ]),
    },
  };
};

export const optionalGmail = (
  secrets: Readonly<Record<string, string>>,
): { readonly gmail?: GmailSettings; } => {
  const clientId = secrets["gmail_client_id"];
  const clientSecret = secrets["gmail_client_secret"];
  const refreshToken = secrets["gmail_refresh_token"];
  if (
    clientId === undefined || clientSecret === undefined
    || refreshToken === undefined
  ) {
    return {};
  }
  return { gmail: { clientId, clientSecret, refreshToken } };
};

export const optionalBlueBubbles = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly bluebubbles?: BlueBubblesSettings; } => {
  if (valueAt(value, ["channels", "bluebubbles", "enabled"]) !== true) {
    return {};
  }
  const password = secrets["bluebubbles_password"];
  if (password === undefined) return {};
  const defaultRecipient = optionalStringAt(value, [
    "channels",
    "bluebubbles",
    "default_recipient",
  ]);
  return {
    bluebubbles: {
      serverUrl: stringAt(value, ["channels", "bluebubbles", "server_url"]),
      password,
      ...(defaultRecipient !== undefined && { defaultRecipient }),
      allowedRecipients: stringArrayAt(value, [
        "channels",
        "bluebubbles",
        "allowed_recipients",
      ]),
    },
  };
};

export const mcpSettings = (
  agent: unknown,
  secrets: Readonly<Record<string, string>>,
): readonly McpEndpointSettings[] => {
  const value = valueAt(agent, ["spec", "mcp"]);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isJsonRecord(item)) return [];
    const id = item["id"];
    const url = item["url"];
    if (typeof id !== "string" || typeof url !== "string") return [];
    const transport = item["transport"];
    if (transport !== "sse" && transport !== "streamable-http") return [];
    const secret = item["authorizationSecret"];
    const authorization = typeof secret === "string"
      ? secrets[secret]
      : undefined;
    return [{
      id,
      url,
      transport,
      ...(authorization !== undefined && { authorization }),
    }];
  });
};

export const optionalStringProperty = <Key extends string>(
  key: Key,
  value: unknown,
  pathSegments: readonly string[],
): { readonly [Property in Key]?: string; } => {
  const result = optionalStringAt(value, pathSegments);
  return optionalValue(key, result);
};

export const optionalValue = <Key extends string>(
  key: Key,
  value: string | undefined,
): { readonly [Property in Key]?: string; } => {
  if (value === undefined || value.length === 0) return {};
  return Object.fromEntries([[key, value]]) as {
    readonly [Property in Key]?: string;
  };
};
