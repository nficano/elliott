import { spyOn } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBundledPackages } from "../../../src/catalog/bundled";
import { loadSkillRegistrations } from "../../../src/runtime/skills/loader";
import type {
  GatewayEvents,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  InboundMessage,
  RuntimeSettings,
  ToolDefinition,
} from "../../../src/runtime/types";

export const repoRoot = path.resolve(import.meta.dir, "../../..");

// A fully-populated fixture: every optional settings block is filled with a
// well-typed dummy value so that every settings-gated skill registers. Tier-0
// smoke asserts that this drives 0 register-time failures — a skill that throws
// under these settings would otherwise degrade silently in production
// (SkillContext.report swallows the error and the runtime boots without it).
export const smokeSettings = (stateDirectory: string): RuntimeSettings => ({
  environment: "smoke",
  release: "smoke",
  timezone: "America/New_York",
  port: 0,
  persona: path.join(repoRoot, "prompts"),
  model: "echo-model",
  maxTokens: 1024,
  temperature: 0,
  llmBaseUrl: "http://127.0.0.1:1/v1",
  llmApiKey: "smoke",
  stateDirectory,
  browser: {
    baseUrl: "http://127.0.0.1:1",
    token: "x",
    allowedDomains: ["example.com"],
  },
  braveApiKey: "x",
  firecrawlApiKey: "x",
  parallelApiKey: "x",
  slack: {
    appToken: "xapp-x",
    botToken: "xoxb-x",
    ownerId: "U0",
    defaultChannel: "C0",
  },
  gmail: {
    clientId: "x",
    clientSecret: "x",
    refreshToken: "x",
    webhookSecret: "gmail-hook",
    pubsubTopic: "projects/smoke/topics/gmail",
  },
  bluebubbles: {
    serverUrl: "http://127.0.0.1:1",
    password: "x",
    allowedRecipients: ["+15555550100"],
    defaultRecipient: "+15555550100",
    webhookSecret: "bluebubbles-hook",
  },
  files: { root: stateDirectory },
  terminal: { root: stateDirectory, allowedCommands: ["echo"] },
  ssh: {
    user: "x",
    hosts: ["localhost"],
    privateKey: "-----BEGIN-----\nx\n-----END-----",
  },
  smtp: {
    host: "127.0.0.1",
    port: 25,
    username: "x",
    password: "x",
    from: "a@b.c",
    allowedRecipients: ["a@b.c"],
  },
  homeAssistant: { baseUrl: "http://127.0.0.1:1", token: "x" },
  cloudflared: { readyUrl: "http://127.0.0.1:1/ready" },
  pihole: { baseUrl: "http://127.0.0.1:1", password: "x" },
  subscriptionUsage: {
    claudeAccounts: [{
      name: "personal",
      credentials: JSON.stringify({
        claudeAiOauth: {
          accessToken: "at-claude",
          refreshToken: "rt-claude",
          expiresAt: 4_102_444_800_000,
        },
      }),
    }],
    codexAccounts: [{
      name: "personal",
      credentials: JSON.stringify({
        tokens: {
          access_token: "at-codex",
          refresh_token: "rt-codex",
          account_id: "acct-1",
        },
        last_refresh: "2026-01-01T00:00:00Z",
      }),
    }],
    litellm: { baseUrl: "http://127.0.0.1:1", apiKey: "sk-litellm" },
  },
  traefik: {
    apiUrl: "http://127.0.0.1:1",
    certResolver: "letsencrypt",
    entryPoint: "websecure",
  },
  webhookSecret: "x",
  mcp: [],
  newsBrief: { keywords: ["ai"], threshold: 1, briefSize: 3, alerts: false },
  pakman: { username: "x", password: "x" },
  youtubeDvr: {
    oauth: { clientId: "x", clientSecret: "x", refreshToken: "x" },
    channels: [],
    providers: [],
    timezone: "America/New_York",
    windowStartHour: 0,
    windowEndHour: 23,
    lookbackSeconds: 60,
    minDurationSeconds: 60,
    pollIntervalSeconds: 3600,
    playlistTitleTemplate: "t",
    playlistPrivacy: "private",
    tool: true,
  },
});

export const makeSmokeContext = async (): Promise<{
  readonly context: SkillContext;
  readonly reported: readonly string[];
  readonly delivered: readonly string[];
}> => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "elliott-smoke-"));
  const reported: string[] = [];
  const delivered: string[] = [];
  return {
    reported,
    delivered,
    context: {
      settings: smokeSettings(stateDirectory),
      stateDirectory,
      report: (error, mechanism) =>
        reported.push(`${mechanism}: ${String(error)}`),
      deliver: async (text) => {
        delivered.push(text);
      },
    },
  };
};

// Load a single skill through the real loader path (loadBundledPackages ->
// loadSkillRegistrations) so Tier-1 exercises exactly what the runtime runs.
export const loadOneSkill = async (
  name: string,
  context: SkillContext,
): Promise<SkillRegistration> => {
  const packages = await loadBundledPackages(repoRoot);
  const selected = packages.filter(
    (item) => item.name === name && item.entrypoint !== undefined,
  );
  const [skill] = await loadSkillRegistrations(selected, context);
  if (skill === undefined) throw new Error(`skill ${name} did not register`);
  return skill.registration;
};

export const toolByName = (
  registration: SkillRegistration,
  name: string,
): ToolDefinition => {
  const tool = registration.tools?.find((item) => item.name === name);
  if (tool === undefined) throw new Error(`tool ${name} not registered`);
  return tool;
};

// A recording GatewayEvents — the exact seam ElliottRuntime wires into every
// gateway and route (onMessage -> agent turn). Tier-1 gateway/route tests drive
// ingress and assert the parsed InboundMessage lands here without booting the
// agent or a real socket.
export const makeGatewayEvents = (): {
  readonly events: GatewayEvents;
  readonly inbound: readonly InboundMessage[];
  readonly errors: readonly unknown[];
} => {
  const inbound: InboundMessage[] = [];
  const errors: unknown[] = [];
  return {
    inbound,
    errors,
    events: {
      onMessage: async (message) => {
        inbound.push(message);
      },
      onFeedback: async () => {},
      onError: (error) => errors.push(error),
    },
  };
};

// A "cassette": spy on the global fetch (the single boundary that
// src/runtime/skills/http.ts request() calls) with canned Responses matched by
// URL substring, recording every requested URL. Undone by mock.restore() in an
// afterEach. This keeps HTTP-tool tests deterministic while still exercising the
// real request() (SSRF guard, ok-check) and the tool's own parse logic.
export const stubFetch = (
  routes: readonly {
    readonly match: string;
    readonly status?: number;
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
  }[],
): { readonly calls: readonly string[]; } => {
  const calls: string[] = [];
  const impl = (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const route = routes.find((item) => url.includes(item.match));
    if (route === undefined) {
      return Promise.reject(new Error(`no cassette route for ${url}`));
    }
    return Promise.resolve(
      new Response(route.body, {
        status: route.status ?? 200,
        headers: route.headers,
      }),
    );
  };
  spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
  return { calls };
};
