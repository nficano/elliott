import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

// gateway-slack/slack-app-manifest.yaml is the source of truth pasted into
// the Slack app's App Manifest page by hand. Slack applies it VERBATIM: if
// it under-declares the event subscriptions or OAuth scopes the gateway
// source relies on, the next apply silently cuts those surfaces off in
// production while the Socket Mode connection keeps reporting healthy
// (2026-07-29: an apply without message.channels made the agent deaf to
// every channel message for days). This is the drift check that used to run
// as elliott-skills/scripts/validate_registry.py's
// validate_slack_app_manifest before the skill moved into core — ported
// here, alongside the skill it validates, so the manifest is never orphaned
// from what enforces it again.

const skillDir = path.resolve(import.meta.dir, "..");
const manifestPath = path.join(skillDir, "slack-app-manifest.yaml");

// Event types the gateway handles (gateway.ts #handleEvent/#handleMessage);
// each entry names why the gateway needs it.
const REQUIRED_BOT_EVENTS: Readonly<Record<string, string>> = {
  app_context_changed: "gateway.ts caches app context for inbound turns",
  app_home_opened: "onboarding.ts posts the App Home welcome",
  "message.channels": "gateway.ts answers owner messages in public channels",
  "message.groups": "gateway.ts answers owner messages in private channels",
  "message.im": "gateway.ts answers owner DMs",
  "message.mpim": "gateway.ts answers owner messages in group DMs",
  reaction_added: "events.ts turns owner reactions into gateway feedback",
};

// Read scope Slack pairs with each event subscription; an apply that keeps
// the event but drops the scope is rejected by Slack, and the scope without
// the event delivers nothing.
const EVENT_SCOPES: Readonly<Record<string, string>> = {
  app_mention: "app_mentions:read",
  "message.channels": "channels:history",
  "message.groups": "groups:history",
  "message.im": "im:history",
  "message.mpim": "mpim:history",
  reaction_added: "reactions:read",
};

// Bot scope required by each Slack Web API method the gateway source calls.
// Methods are discovered by scanning src/*.ts string literals; a discovered
// method with no entry here fails validation so this map cannot silently rot.
const METHOD_SCOPES: Readonly<Record<string, readonly string[]>> = {
  "assistant.search.context": ["search:read.public"],
  "assistant.threads.setStatus": ["assistant:write"],
  "assistant.threads.setSuggestedPrompts": ["assistant:write"],
  "assistant.threads.setTitle": ["assistant:write"],
  "auth.test": [],
  "chat.appendStream": ["chat:write"],
  "chat.delete": ["chat:write"],
  "chat.postMessage": ["chat:write"],
  "chat.startStream": ["chat:write"],
  "chat.stopStream": ["chat:write"],
  "conversations.history": [
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ],
  "conversations.replies": [
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ],
};

// App-level (xapp token) methods; they take no bot scopes.
const APP_LEVEL_METHODS: ReadonlySet<string> = new Set([
  "apps.connections.open",
]);

const METHOD_PATTERN =
  /"((?:apps|assistant|auth|bots|chat|conversations|files|reactions|search|users|views)\.[A-Za-z][A-Za-z.]*)"/g;

const parseManifest = async () => {
  const raw = await readFile(manifestPath, "utf8");
  const app = parse(raw) as Record<string, unknown>;
  const settings = (app["settings"] ?? {}) as Record<string, unknown>;
  const eventSubscriptions = (settings["event_subscriptions"] ?? {}) as Record<
    string,
    unknown
  >;
  const oauthConfig = (app["oauth_config"] ?? {}) as Record<string, unknown>;
  const scopes = (oauthConfig["scopes"] ?? {}) as Record<string, unknown>;
  const interactivity = (settings["interactivity"] ?? {}) as Record<
    string,
    unknown
  >;
  return {
    botEvents: new Set(
      eventSubscriptions["bot_events"] as readonly string[] | undefined,
    ),
    botScopes: new Set(scopes["bot"] as readonly string[] | undefined),
    socketModeEnabled: settings["socket_mode_enabled"] === true,
    interactivityEnabled: interactivity["is_enabled"] === true,
  };
};

// Every Slack Web API method string literal referenced anywhere in
// gateway-slack's own src/*.ts.
const calledMethods = async (): Promise<ReadonlySet<string>> => {
  const srcDir = path.join(skillDir, "src");
  const files = await readdir(srcDir, { recursive: true });
  const methods = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const text = await readFile(path.join(srcDir, file), "utf8");
    for (const match of text.matchAll(METHOD_PATTERN)) {
      const method = match[1];
      if (method !== undefined) methods.add(method);
    }
  }
  return methods;
};

describe("gateway-slack slack-app-manifest.yaml event/scope coverage", () => {
  it("declares every bot event the gateway source depends on", async () => {
    const { botEvents } = await parseManifest();
    for (const [event, why] of Object.entries(REQUIRED_BOT_EVENTS)) {
      expect(botEvents.has(event), `missing bot_events entry ${event} — ${why}`)
        .toBe(true);
    }
  });

  it("pairs every subscribed event with its required read scope", async () => {
    const { botEvents, botScopes } = await parseManifest();
    for (const event of botEvents) {
      const scope = EVENT_SCOPES[event];
      if (scope === undefined) continue;
      expect(
        botScopes.has(scope),
        `subscribes ${event} but lacks its paired read scope ${scope}`,
      ).toBe(true);
    }
  });

  it("grants every scope a Slack method the source actually calls needs", async () => {
    const { botScopes } = await parseManifest();
    const methods = await calledMethods();
    for (const method of methods) {
      if (APP_LEVEL_METHODS.has(method)) continue;
      const required = METHOD_SCOPES[method];
      expect(
        required,
        `src calls Slack method ${method} with no entry in METHOD_SCOPES — `
          + "add it and its required scope(s)",
      ).toBeDefined();
      for (const scope of required ?? []) {
        expect(
          botScopes.has(scope),
          `${method} needs scope ${scope}, missing from oauth_config.scopes.bot`,
        ).toBe(true);
      }
    }
  });
});

describe("gateway-slack slack-app-manifest.yaml delivery settings", () => {
  it("keeps Socket Mode and interactivity enabled", async () => {
    const { socketModeEnabled, interactivityEnabled } = await parseManifest();
    expect(
      socketModeEnabled,
      "socket_mode_enabled must stay true — the gateway connects via Socket "
        + "Mode; without it no events flow",
    ).toBe(true);
    expect(
      interactivityEnabled,
      "settings.interactivity.is_enabled must stay true — block actions feed "
        + "gateway feedback",
    ).toBe(true);
  });
});
