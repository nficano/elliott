import * as Redacted from "effect/Redacted";
import { Hono } from "hono";
import type { Inbound } from "../../core/channels/types.js";
import type { Health, Lifecycle } from "../../core/types.js";
import type { HttpHandlers, HttpOpts } from "./types.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * The one HTTP server (Hono) — §3. `/healthz`,`/readyz` (open); a control API
 * (`/config/*`, `/footprint`, job status, manual triggers) behind a
 * Vault-sourced bearer (§3 authz — "LAN-only via Traefik" is a network
 * assumption, not access control); and inbound event/channel webhooks fronted by
 * the injection screen (a different surface). Outbound alert delivery is the
 * egress side of this same server (§16.4).
 */
export function buildApp(opts: HttpOpts): Hono {
  const app = new Hono();
  addHealthRoutes(app, opts.handlers);
  app.route("/control", buildControlApp(opts));
  addIngressRoute(app, opts.handlers);
  addEventRoute(app, opts.handlers);
  return app;
}

function addHealthRoutes(app: Hono, handlers: HttpHandlers): void {
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    const h = await handlers.ready();
    const status = h.state === "down" ? HTTP_SERVICE_UNAVAILABLE : HTTP_OK;
    return c.json(h, status);
  });
}

function buildControlApp(opts: HttpOpts): Hono {
  const control = new Hono();
  const { handlers, controlToken } = opts;
  control.use("*", async (c, next) => {
    if (!controlToken) {
      return c.json(
        { error: "control API disabled (no token configured)" },
        HTTP_FORBIDDEN,
      );
    }
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${Redacted.value(controlToken)}`) {
      return c.json({ error: "unauthorized" }, HTTP_UNAUTHORIZED);
    }
    await next();
  });
  control.post(
    "/config/reload",
    async (c) => c.json(await handlers.reloadConfig()),
  );
  control.get(
    "/footprint",
    async (c) => c.json(await handlers.footprint(c.req.query("since"))),
  );
  control.get("/jobs", async (c) => c.json(await handlers.jobsStatus()));
  control.post("/triggers/:id", async (c) => {
    const body = await safeJson(c.req.raw);
    return c.json(await handlers.trigger(c.req.param("id"), body));
  });
  return control;
}

function addIngressRoute(app: Hono, handlers: HttpHandlers): void {
  app.post("/ingress/:channel", async (c) => {
    const body = (await safeJson(c.req.raw)) as Partial<Inbound> | undefined;
    if (
      !body || typeof body.text !== "string"
      || typeof body.externalId !== "string"
    ) {
      return c.json({ error: "invalid inbound" }, HTTP_BAD_REQUEST);
    }
    const msg: Inbound = {
      channel: c.req.param("channel"),
      externalId: body.externalId,
      conversationKey: body.conversationKey
        ?? `${c.req.param("channel")}:${body.senderId ?? "?"}`,
      senderId: body.senderId ?? "unknown",
      text: body.text,
      origin: "untrusted", // ingress is untrusted until the screen clears it (§16)
      receivedAt: new Date().toISOString(),
    };
    await handlers.ingress(msg);
    return c.json({ accepted: true });
  });
}

function addEventRoute(app: Hono, handlers: HttpHandlers): void {
  if (handlers.event) {
    app.post("/api/events", async (c) => {
      const body = (await safeJson(c.req.raw)) as {
        topic?: string;
        payload?: unknown;
      } | undefined;
      if (!body?.topic) {
        return c.json({ error: "missing topic" }, HTTP_BAD_REQUEST);
      }
      await handlers.event!(body.topic, body.payload);
      return c.json({ accepted: true });
    });
  }
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** Lifecycle wrapper so the supervisor can start/stop the HTTP server (§3). */
export class HttpServer implements Lifecycle {
  readonly name = "http";
  private server: ReturnType<typeof Bun.serve> | undefined;

  constructor(private readonly opts: HttpOpts) {}

  async start(): Promise<void> {
    const app = buildApp(this.opts);
    this.server = Bun.serve({ port: this.opts.port, fetch: app.fetch });
    console.info(`http: listening on :${this.opts.port}`);
  }

  async stop(): Promise<void> {
    await this.server?.stop(true);
    this.server = undefined;
  }

  async health(): Promise<Health> {
    return this.server
      ? { state: "ok" }
      : { state: "down", detail: "http not started" };
  }
}
