import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HTTP_NOT_FOUND } from "../../../src/runtime/http";
import type {
  GatewayEvents,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
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

const events: GatewayEvents = {
  onMessage: async (message) => {
    const response = await gateway?.beginResponse?.(message);
    await response?.complete(`echo: ${message.text}`);
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
