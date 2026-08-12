import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
  optionalCloudflared,
  optionalFiles,
  optionalHomeAssistant,
  optionalPihole,
  optionalSmtp,
  optionalSsh,
  optionalSubscriptionUsage,
  optionalTerminal,
  optionalTraefik,
  optionalWebhookProvisioner,
} from "../../../src/runtime/settings-tools";

const ROOT = "/var/elliott-root";

describe("optionalFiles / optionalTerminal", () => {
  it("files defaults on with workspace root; explicit false disables", () => {
    expect(optionalFiles({}, ROOT)).toEqual({
      files: { root: path.resolve(ROOT, ".elliott-runtime/workspace") },
    });
    expect(optionalFiles({
      tools: { files: { enabled: false } },
    }, ROOT)).toEqual({});
    expect(optionalFiles({
      tools: { files: { root: "custom" } },
    }, ROOT)).toEqual({
      files: { root: path.resolve(ROOT, "custom") },
    });
  });

  it("terminal fails closed without an allowlist", () => {
    expect(optionalTerminal({
      tools: { terminal: { enabled: true, allowed_commands: [] } },
    }, ROOT)).toEqual({});
    expect(optionalTerminal({
      tools: {
        terminal: {
          enabled: true,
          allowed_commands: ["ls"],
          root: "term",
        },
      },
    }, ROOT)).toEqual({
      terminal: {
        root: path.resolve(ROOT, "term"),
        allowedCommands: ["ls"],
      },
    });
  });
});

describe("optionalSsh / optionalSmtp / HA / pihole", () => {
  it("ssh requires enabled, key, and hosts", () => {
    expect(optionalSsh({ tools: { ssh: { enabled: true } } }, {})).toEqual({});
    expect(optionalSsh(
      { tools: { ssh: { enabled: true, user: "u", hosts: ["h"] } } },
      { ssh_private_key: "k" },
    )).toEqual({
      ssh: { user: "u", hosts: ["h"], privateKey: "k" },
    });
  });

  it("smtp requires recipients and password", () => {
    expect(optionalSmtp({
      channels: {
        email: {
          enabled: true,
          smtp_host: "smtp",
          username: "u",
          from: "a@b",
          allowed_recipients: [],
        },
      },
    }, { smtp_password: "p" })).toEqual({});
    expect(optionalSmtp({
      channels: {
        email: {
          enabled: true,
          smtp_host: "smtp",
          username: "u",
          from: "a@b",
          allowed_recipients: ["x@y"],
          smtp_port: 587,
        },
      },
    }, { smtp_password: "p" })).toEqual({
      smtp: {
        host: "smtp",
        port: 587,
        username: "u",
        password: "p",
        from: "a@b",
        allowedRecipients: ["x@y"],
      },
    });
  });

  it("home assistant and pihole require secrets", () => {
    expect(optionalHomeAssistant({
      channels: { home_assistant: { enabled: true, base_url: "http://ha" } },
    }, {})).toEqual({});
    expect(optionalHomeAssistant({
      channels: { home_assistant: { enabled: true, base_url: "http://ha" } },
    }, { ha_token: "t" })).toEqual({
      homeAssistant: { baseUrl: "http://ha", token: "t" },
    });
    expect(optionalPihole({
      tools: { pihole: { enabled: true, base_url: "http://pi" } },
    }, { pihole_password: "pw" })).toEqual({
      pihole: { baseUrl: "http://pi", password: "pw" },
    });
  });
});

describe("optionalTraefik / webhook / cloudflared / subscription", () => {
  it("traefik applies defaults for cert resolver and entry point", () => {
    expect(optionalTraefik({})).toEqual({});
    expect(optionalTraefik({
      tools: {
        traefik: {
          enabled: true,
          api_url: "http://traefik",
          lan_address: "192.0.2.10",
        },
      },
    })).toEqual({
      traefik: {
        apiUrl: "http://traefik",
        certResolver: "letsencrypt",
        entryPoint: "websecure",
        lanAddress: "192.0.2.10",
      },
    });
  });

  it("webhook provisioner and cloudflared need URLs", () => {
    expect(optionalWebhookProvisioner({
      gateways: { webhook_provisioner: { enabled: true } },
    })).toEqual({});
    expect(optionalWebhookProvisioner({
      gateways: {
        webhook_provisioner: {
          enabled: true,
          hooks_base_url: "https://hooks.example",
        },
      },
    })).toEqual({
      webhookProvisioner: { hooksBaseUrl: "https://hooks.example" },
    });
    expect(optionalCloudflared({})).toEqual({});
    expect(optionalCloudflared({
      gateways: { cloudflared: { ready_url: "http://ready" } },
    })).toEqual({ cloudflared: { readyUrl: "http://ready" } });
  });

  it("subscription usage skips unresolved accounts and empty configs", () => {
    expect(optionalSubscriptionUsage({
      tools: { subscription_usage: { enabled: true } },
    }, {})).toEqual({});
    expect(optionalSubscriptionUsage({
      tools: {
        subscription_usage: {
          enabled: true,
          claude_accounts: [
            { name: "a", secret: "missing" },
            { name: "b", secret: "ok" },
            { bad: true },
          ],
          codex_accounts: "nope",
          litellm: { base_url: "http://litellm" },
        },
      },
    }, { ok: "creds", litellm_admin_key: "admin" })).toEqual({
      subscriptionUsage: {
        claudeAccounts: [{ name: "b", credentials: "creds" }],
        codexAccounts: [],
        litellm: { baseUrl: "http://litellm", apiKey: "admin" },
      },
    });
  });
});
