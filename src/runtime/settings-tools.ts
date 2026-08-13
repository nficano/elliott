import path from "node:path";
import { isJsonRecord } from "../providers/http";
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
  LitellmSpendSettings,
  PiholeSettings,
  SearchDuckDuckGoSettings,
  SmtpSettings,
  SshSettings,
  SubscriptionAccountSettings,
  SubscriptionUsageSettings,
  TerminalSettings,
  TraefikSettings,
  VaultSettings,
  WebhookProvisionerSettings,
} from "./types";

const DEFAULT_WORKSPACE = ".elliott-runtime/workspace";
const DEFAULT_SMTPS_PORT = 465;
const DEFAULT_CERT_RESOLVER = "letsencrypt";
const DEFAULT_ENTRY_POINT = "websecure";

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

export const optionalPihole = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly pihole?: PiholeSettings; } => {
  if (valueAt(value, ["tools", "pihole", "enabled"]) !== true) return {};
  const password = secrets["pihole_password"];
  if (password === undefined) return {};
  return {
    pihole: {
      baseUrl: stringAt(value, ["tools", "pihole", "base_url"]),
      password,
    },
  };
};

export const optionalTraefik = (
  value: unknown,
): { readonly traefik?: TraefikSettings; } => {
  if (valueAt(value, ["tools", "traefik", "enabled"]) !== true) return {};
  const lanAddress = optionalStringAt(value, [
    "tools",
    "traefik",
    "lan_address",
  ]);
  return {
    traefik: {
      apiUrl: stringAt(value, ["tools", "traefik", "api_url"]),
      certResolver:
        optionalStringAt(value, ["tools", "traefik", "cert_resolver"])
          ?? DEFAULT_CERT_RESOLVER,
      entryPoint: optionalStringAt(value, ["tools", "traefik", "entry_point"])
        ?? DEFAULT_ENTRY_POINT,
      ...(lanAddress !== undefined && { lanAddress }),
    },
  };
};

// No secret needed, but bundling it in core makes it reachable by every
// agent unless an operator opts in — unlike the registry, where it only ran
// for agents that explicitly installed it.
export const optionalSearchDuckDuckGo = (
  value: unknown,
): { readonly searchDuckduckgo?: SearchDuckDuckGoSettings; } => {
  if (valueAt(value, ["tools", "search_duckduckgo", "enabled"]) !== true) {
    return {};
  }
  return { searchDuckduckgo: { enabled: true } };
};

export const optionalWebhookProvisioner = (
  value: unknown,
): { readonly webhookProvisioner?: WebhookProvisionerSettings; } => {
  const base = ["gateways", "webhook_provisioner"];
  if (valueAt(value, [...base, "enabled"]) !== true) return {};
  const hooksBaseUrl = optionalStringAt(value, [...base, "hooks_base_url"]);
  if (hooksBaseUrl === undefined || hooksBaseUrl.length === 0) return {};
  return { webhookProvisioner: { hooksBaseUrl } };
};

export const optionalSubscriptionUsage = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly subscriptionUsage?: SubscriptionUsageSettings; } => {
  const base = ["tools", "subscription_usage"];
  if (valueAt(value, [...base, "enabled"]) !== true) return {};
  const claudeAccounts = usageAccounts(
    valueAt(value, [...base, "claude_accounts"]),
    secrets,
  );
  const codexAccounts = usageAccounts(
    valueAt(value, [...base, "codex_accounts"]),
    secrets,
  );
  const litellm = litellmSpend(value, [...base, "litellm"], secrets);
  if (
    claudeAccounts.length === 0 && codexAccounts.length === 0
    && litellm === undefined
  ) {
    return {};
  }
  return {
    subscriptionUsage: {
      claudeAccounts,
      codexAccounts,
      ...(litellm !== undefined && { litellm }),
    },
  };
};

// Accounts whose secret has not resolved are skipped, not fatal: the rest of
// the accounts (and the skill) still register.
const usageAccounts = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): readonly SubscriptionAccountSettings[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isJsonRecord(item)) return [];
    const name = item["name"];
    const secret = item["secret"];
    if (typeof name !== "string" || typeof secret !== "string") return [];
    const credentials = secrets[secret];
    return credentials === undefined ? [] : [{ name, credentials }];
  });
};

const litellmSpend = (
  value: unknown,
  base: readonly string[],
  secrets: Readonly<Record<string, string>>,
): LitellmSpendSettings | undefined => {
  const baseUrl = optionalStringAt(value, [...base, "base_url"]);
  const apiKey = secrets["litellm_admin_key"];
  if (baseUrl === undefined || apiKey === undefined) return undefined;
  return { baseUrl, apiKey };
};

// HashiCorp Vault, off unless explicitly enabled AND fully specified. Like the
// ssh tool it fails closed: it registers only when the flag is true and a
// NON-EMPTY token, a non-empty address, and at least one non-empty allowlist
// path are all present. Empty/whitespace values (an unset `${ENV:…}` rendered to
// "", a `paths: [""]` typo) are treated as absent, not accepted — an unusable
// Vault tool must not register as enabled. The token resolves from secrets.yaml
// (`vault_token`) at the boundary.
export const optionalVault = (
  value: unknown,
  secrets: Readonly<Record<string, string>>,
): { readonly vault?: VaultSettings; } => {
  if (valueAt(value, ["tools", "vault", "enabled"]) !== true) return {};
  const token = secrets["vault_token"];
  if (token === undefined || token.trim().length === 0) return {};
  const address = optionalStringAt(value, ["tools", "vault", "address"]);
  if (address === undefined || address.trim().length === 0) return {};
  const paths = stringArrayAt(value, ["tools", "vault", "paths"])
    .filter((path) => path.trim().length > 0);
  if (paths.length === 0) return {};
  return { vault: { address, token, paths } };
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
