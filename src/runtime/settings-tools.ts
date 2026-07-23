import path from "node:path";
import {
  optionalNumberAt,
  optionalStringAt,
  stringArrayAt,
  stringAt,
  valueAt,
} from "./settings";
import type {
  CloudflaredSettings,
  FilesSettings,
  HomeAssistantSettings,
  SmtpSettings,
  SshSettings,
  TerminalSettings,
} from "./types";

const DEFAULT_WORKSPACE = ".elliott-runtime/workspace";
const DEFAULT_SMTPS_PORT = 465;

export const optionalFiles = (
  value: unknown,
  root: string,
): { readonly files?: FilesSettings; } => {
  if (valueAt(value, ["tools", "files", "enabled"]) === false) return {};
  const configured = optionalStringAt(value, ["tools", "files", "root"]);
  return {
    files: { root: path.resolve(root, configured ?? DEFAULT_WORKSPACE) },
  };
};

export const optionalTerminal = (
  value: unknown,
  root: string,
): { readonly terminal?: TerminalSettings; } => {
  if (valueAt(value, ["tools", "terminal", "enabled"]) !== true) return {};
  const allowedCommands = stringArrayAt(value, [
    "tools",
    "terminal",
    "allowed_commands",
  ]);
  if (allowedCommands.length === 0) return {};
  const configured = optionalStringAt(value, ["tools", "terminal", "root"]);
  return {
    terminal: {
      root: path.resolve(root, configured ?? DEFAULT_WORKSPACE),
      allowedCommands,
    },
  };
};

export const optionalSsh = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly ssh?: SshSettings; } => {
  if (valueAt(value, ["tools", "ssh", "enabled"]) !== true) return {};
  const privateKey = secrets["ssh_private_key"];
  if (privateKey === undefined) return {};
  const hosts = stringArrayAt(value, ["tools", "ssh", "hosts"]);
  if (hosts.length === 0) return {};
  return {
    ssh: { user: stringAt(value, ["tools", "ssh", "user"]), hosts, privateKey },
  };
};

export const optionalSmtp = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly smtp?: SmtpSettings; } => {
  if (valueAt(value, ["channels", "email", "enabled"]) !== true) return {};
  const password = secrets["smtp_password"];
  if (password === undefined) return {};
  const allowedRecipients = stringArrayAt(value, [
    "channels",
    "email",
    "allowed_recipients",
  ]);
  if (allowedRecipients.length === 0) return {};
  return {
    smtp: {
      host: stringAt(value, ["channels", "email", "smtp_host"]),
      port: optionalNumberAt(value, ["channels", "email", "smtp_port"])
        ?? DEFAULT_SMTPS_PORT,
      username: stringAt(value, ["channels", "email", "username"]),
      password,
      from: stringAt(value, ["channels", "email", "from"]),
      allowedRecipients,
    },
  };
};

export const optionalHomeAssistant = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly homeAssistant?: HomeAssistantSettings; } => {
  if (valueAt(value, ["channels", "home_assistant", "enabled"]) !== true) {
    return {};
  }
  const token = secrets["ha_token"];
  if (token === undefined) return {};
  return {
    homeAssistant: {
      baseUrl: stringAt(value, ["channels", "home_assistant", "base_url"]),
      token,
    },
  };
};

export const optionalCloudflared = (
  value: unknown,
): { readonly cloudflared?: CloudflaredSettings; } => {
  const readyUrl = optionalStringAt(value, [
    "gateways",
    "cloudflared",
    "ready_url",
  ]);
  return readyUrl === undefined ? {} : { cloudflared: { readyUrl } };
};
