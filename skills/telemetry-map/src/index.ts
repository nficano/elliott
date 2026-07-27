import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from "../../../src/runtime/http";
import type {
  GatewayEvents,
  RouteBinding,
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { runtimeTelemetry } from "../../../src/runtime/telemetry";
import { Aggregator } from "./aggregator";
import { appDistRoutes } from "./app-dist";
import { assetRoutes } from "./assets";
import { TelemetryMapGateway } from "./gateway";
import { SqliteTail } from "./sqlite-tail";
import { streamResponse } from "./sse";
import { loadTopology } from "./topology";

const BASE = "/v1/observability/map";
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_EVERY_TICKS = 10;
const UI_URL = new URL("ui.html", import.meta.url);
const SEND_TIMEOUT_MS = 180_000;

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const gateway = new TelemetryMapGateway();
  const aggregator = new Aggregator({
    environment: context.settings.environment,
    release: context.settings.release,
    configuredModel: context.settings.model,
    promptsEnabled: runtimeTelemetry.promptsEnabled,
  });
  const tail = new SqliteTail(
    path.join(context.stateDirectory, "sessions.sqlite"),
    (snapshot, deltas) => {
      aggregator.setDb(snapshot);
      for (const delta of deltas) {
        runtimeTelemetry.emit("db.write", {
          table: delta.table,
          count: delta.count,
          delta: delta.delta,
        });
      }
    },
    (error) => context.report(error, "telemetry-map:tail"),
  );
  // When the Nuxt rewrite is built (app/dist), it serves the explorer UI and
  // the legacy single-file document stays reachable at /legacy; without a
  // build the legacy document remains the primary UI.
  const dist = await appDistRoutes(BASE);
  return {
    gateways: [gateway],
    routes: [
      ...routes(aggregator, gateway, dist.index ?? uiResponse),
      ...dist.routes,
    ],
    services: [service(aggregator, tail)],
  };
};

const jsonResponse = (value: unknown): Response =>
  Response.json(value, { status: HTTP_OK });

const uiResponse = async (): Promise<Response> => {
  try {
    const html = await readFile(UI_URL, "utf8");
    return new Response(html, {
      status: HTTP_OK,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("telemetry-map UI asset is missing", {
      status: HTTP_NOT_FOUND,
    });
  }
};

const topologyResponse = async (): Promise<Response> =>
  new Response(await loadTopology(), {
    status: HTTP_OK,
    headers: { "content-type": "application/json" },
  });

const turnResponse = (aggregator: Aggregator, request: Request): Response => {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return Response.json({ error: "missing id" }, { status: HTTP_BAD_REQUEST });
  }
  return jsonResponse(aggregator.turn(id));
};

// POST /v1/observability/map/send — inject a message into the agent and
// return the answer as JSON.  The SSE stream animates the turn in real-time
// while this request is held open (up to SEND_TIMEOUT_MS).
const sendResponse = async (
  request: Request,
  events: GatewayEvents,
  gateway: TelemetryMapGateway,
): Promise<Response> => {
  let body: { text?: unknown; sender?: unknown; };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "invalid json" },
      { status: HTTP_BAD_REQUEST },
    );
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json(
      { error: "text is required" },
      { status: HTTP_BAD_REQUEST },
    );
  }
  const sender = typeof body.sender === "string" && body.sender
    ? body.sender
    : "map-observer";
  const channel = "telemetry-map:interactive";
  const messageId = crypto.randomUUID();

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(
      () => resolve("(response timed out — check #feed or the SSE stream)"),
      SEND_TIMEOUT_MS,
    )
  );

  const answerPromise = gateway.captureResponse(channel, () => {
    void events.onMessage({
      id: messageId,
      gateway: "telemetry-map",
      channel,
      sender,
      text,
    });
  });

  const answer = await Promise.race([answerPromise, timeoutPromise]);
  return jsonResponse({ answer });
};

const route = (
  method: string,
  routePath: string,
  handler: (request: Request) => Promise<Response>,
): RouteBinding => ({
  method,
  path: routePath,
  handle: (request) => handler(request),
});

const routeE = (
  method: string,
  routePath: string,
  handler: (request: Request, events: GatewayEvents) => Promise<Response>,
): RouteBinding => ({
  method,
  path: routePath,
  handle: (request, events) => handler(request, events),
});

const routes = (
  aggregator: Aggregator,
  gateway: TelemetryMapGateway,
  ui: () => Promise<Response>,
): readonly RouteBinding[] => [
  route("GET", BASE, () => ui()),
  route("GET", `${BASE}/legacy`, () => uiResponse()),
  route("GET", `${BASE}/topology`, () => topologyResponse()),
  route(
    "GET",
    `${BASE}/state`,
    () => Promise.resolve(jsonResponse(aggregator.snapshot())),
  ),
  route(
    "GET",
    `${BASE}/stream`,
    () => Promise.resolve(streamResponse(aggregator)),
  ),
  route(
    "GET",
    `${BASE}/turn`,
    (request) => Promise.resolve(turnResponse(aggregator, request)),
  ),
  ...assetRoutes(BASE),
  routeE(
    "POST",
    `${BASE}/send`,
    (request, events) => sendResponse(request, events, gateway),
  ),
];

const service = (
  aggregator: Aggregator,
  tail: SqliteTail,
): ServiceBinding => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticks = 0;
  return {
    name: "telemetry-map",
    start: () => {
      aggregator.start(runtimeTelemetry);
      tail.tick();
      timer = setInterval(() => {
        ticks += 1;
        tail.tick();
        if (ticks % HEARTBEAT_EVERY_TICKS === 0) {
          runtimeTelemetry.emit("heartbeat", {});
        }
      }, POLL_INTERVAL_MS);
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      tail.close();
      aggregator.stop();
    },
    health: () => aggregator.health(),
  };
};
