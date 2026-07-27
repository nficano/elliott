import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HTTP_NOT_FOUND } from "../../../src/runtime/http";
import type {
  GatewayEvents,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { runtimeTelemetry } from "../../../src/runtime/telemetry";
import type { RuntimeSettings } from "../../../src/runtime/types";
import { register } from "../src/index";

// A minimal loopback host for the telemetry-map extension: mounts its real
// routes on Bun.serve with an echo agent behind /send. Used by the Playwright
// parity suite (legacy UI at /legacy, Nuxt rewrite at the base path) and for
// manual inspection. Never deployed.
const DEFAULT_PORT = 18_099;
const port = Number(Bun.env["TELEMETRY_MAP_PORT"] ?? DEFAULT_PORT);

const settings = {
  environment: "e2e",
  release: "e2e-harness",
  model: "echo-model",
} as RuntimeSettings;

const registration: SkillRegistration = await register({
  settings,
  stateDirectory: await mkdtemp(path.join(tmpdir(), "telemetry-map-e2e-")),
  report: (error, mechanism) => {
    console.error(`[harness] ${mechanism}:`, error);
  },
  deliver: async () => {},
});

const gateway = registration.gateways?.[0];

// The background service subscribes the aggregator to the telemetry bus so
// /state, /stream, and /turn behave like production.
await registration.services?.[0]?.start();

// Emit the telemetry a real turn would produce, so the live map animation,
// the invocations list, and the trace replay all work against the harness.
const simulateTurnTelemetry = (
  message: {
    id: string;
    gateway: string;
    channel: string;
    sender: string;
    text: string;
  },
  answer: string,
): void => {
  const turnId = `turn:${crypto.randomUUID()}`;
  const emit = runtimeTelemetry.emit.bind(runtimeTelemetry);
  emit("inbound", {
    messageId: message.id,
    gateway: message.gateway,
    channel: message.channel,
    sender: message.sender,
    textLength: message.text.length,
    text: message.text,
  }, turnId);
  emit("turn.begin", {
    conversation: `${message.gateway}:${message.channel}:root`,
  }, turnId);
  emit("model.request", {
    round: 1,
    messageCount: 2,
    toolNames: ["fetch", "files"],
    systemDigest: "digest:harness-system",
    messagesDigest: "digest:harness-messages",
    system: "You are Elliott (e2e harness).",
    messages: [{ role: "user", content: message.text }],
  }, turnId);
  emit("model.selection", { routeDigest: "digest:harness-route" }, turnId);
  emit("tool.progress", {
    id: "tool-1",
    name: "fetch",
    status: "complete",
    resultDigest: "digest:harness-result",
  }, turnId);
  emit("turn.finish", {
    disposition: "success",
    answerLength: answer.length,
    answer,
  }, turnId);
};

const events: GatewayEvents = {
  onMessage: async (message) => {
    const answer = `echo: ${message.text}`;
    simulateTurnTelemetry(message, answer);
    const response = await gateway?.beginResponse?.(message);
    await response?.complete(answer);
  },
  onFeedback: async () => {},
  onError: (error) => {
    console.error("[harness] gateway error:", error);
  },
};

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const url = new URL(request.url);
    const route = registration.routes?.find(
      (item) => item.method === request.method && item.path === url.pathname,
    );
    if (route === undefined) {
      return new Response("Not found", { status: HTTP_NOT_FOUND });
    }
    return route.handle(request, events);
  },
});

console.log(`telemetry-map e2e harness listening on ${server.url.href}`);
