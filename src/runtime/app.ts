import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadBundledPackages } from "../catalog/bundled";
import type { BundledPackage } from "../catalog/types";
import { AgentKernel } from "../kernel";
import { RuntimeAgent } from "./agent";
import { loadRuntimeSettings } from "./config";
import { RuntimeModelClient } from "./model/client";
import { RuntimeErrorReporter } from "./reporter";
import {
  collectGateways,
  collectRoutes,
  collectServices,
  collectTools,
  loadSkillRegistrations,
} from "./skills/loader";
import type {
  GatewayBinding,
  GatewayEvents,
  RouteBinding,
  ServiceBinding,
  SkillContext,
} from "./skills/types";
import type { InboundMessage, RuntimeHealth, RuntimeSettings } from "./types";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

export class ElliottRuntime {
  readonly #root: string;
  readonly #kernel = new AgentKernel({ posture: "standard" });
  #settings: RuntimeSettings | undefined;
  #packages: readonly BundledPackage[] = [];
  #gateways: readonly GatewayBinding[] = [];
  #routes: readonly RouteBinding[] = [];
  #services: readonly ServiceBinding[] = [];
  #agent: RuntimeAgent | undefined;
  #reporter: RuntimeErrorReporter | undefined;
  #server: ReturnType<typeof Bun.serve> | undefined;
  #ready = false;
  #toolCount = 0;
  readonly #seen = new Set<string>();
  readonly #inflight = new Set<string>();

  constructor(root: string) {
    this.#root = root;
  }

  async start(): Promise<void> {
    const settings = await loadRuntimeSettings(this.#root);
    this.#settings = settings;
    this.#reporter = new RuntimeErrorReporter(
      settings.glitchtipDsn,
      settings.environment,
      settings.release,
    );
    await this.#kernel.start();
    this.#packages = await loadBundledPackages(this.#root);
    const skills = await loadSkillRegistrations(
      this.#packages,
      this.#skillContext(settings),
    );
    const tools = collectTools(skills);
    this.#gateways = collectGateways(skills);
    this.#routes = collectRoutes(skills);
    this.#services = collectServices(skills);
    this.#toolCount = tools.length;
    const persona = await readFile(settings.persona, "utf8");
    this.#agent = new RuntimeAgent(
      new RuntimeModelClient(settings),
      persona,
      tools,
    );
    await this.#startBindings();
    this.#startServer(settings.port);
    this.#ready = true;
    this.#logStarted(settings);
  }

  async stop(): Promise<void> {
    this.#ready = false;
    for (const gateway of this.#gateways) await gateway.stop();
    for (const service of this.#services) await service.stop();
    await this.#server?.stop();
    await this.#kernel.stop();
  }

  health(): RuntimeHealth {
    const settings = this.#settings;
    return {
      ready: this.#ready,
      release: settings?.release ?? "starting",
      skills: this.#packages.length,
      tools: this.#toolCount,
      gateways: Object.fromEntries(
        this.#gateways.map((gateway) => [gateway.name, gateway.status()]),
      ),
      services: Object.fromEntries(
        this.#services.map((service) => [
          service.name,
          service.health?.() ?? {},
        ]),
      ),
    };
  }

  #skillContext(settings: RuntimeSettings): SkillContext {
    return {
      settings,
      stateDirectory: path.join(this.#root, ".elliott-runtime"),
      report: (error, mechanism) => this.#capture(error, mechanism),
      deliver: (text) => this.#deliver(text),
    };
  }

  #events(): GatewayEvents {
    return {
      onMessage: (message) => this.#handleInbound(message),
      onError: (error) => this.#capture(error, "gateway"),
    };
  }

  async #startBindings(): Promise<void> {
    const events = this.#events();
    for (const gateway of this.#gateways) {
      try {
        await gateway.start(events);
      } catch (error) {
        this.#capture(error, `gateway:${gateway.name}`);
      }
    }
    for (const service of this.#services) {
      try {
        await service.start();
      } catch (error) {
        this.#capture(error, `service:${service.name}`);
      }
    }
  }

  async #deliver(text: string): Promise<void> {
    const primary = this.#primaryGateway();
    if (primary?.send === undefined) {
      throw new Error("No gateway is available for delivery");
    }
    await primary.send(primary.defaultChannel ?? "", text);
  }

  #primaryGateway(): GatewayBinding | undefined {
    return this.#gateways.find(
      (gateway) =>
        gateway.send !== undefined && gateway.defaultChannel !== undefined,
    ) ?? this.#gateways.find((gateway) => gateway.send !== undefined);
  }

  #replyGateway(message: InboundMessage): GatewayBinding | undefined {
    const origin = this.#gateways.find(
      (gateway) => gateway.name === message.gateway,
    );
    return origin?.send === undefined ? this.#primaryGateway() : origin;
  }

  async #handleInbound(message: InboundMessage): Promise<void> {
    if (this.#seen.has(message.id)) return;
    this.#seen.add(message.id);
    const gateway = this.#replyGateway(message);
    const reply = async (text: string): Promise<void> => {
      await gateway?.send?.(message.channel, text, message.thread);
    };
    const conversation = `${message.gateway}:${message.channel}:${
      message.thread ?? "root"
    }`;
    if (this.#inflight.has(conversation)) {
      await reply("One moment—I’m still working on your previous message.");
      return;
    }
    const agent = this.#agent;
    if (agent === undefined) throw new Error("Runtime agent is not ready");
    this.#inflight.add(conversation);
    try {
      await reply(await agent.turn(conversation, message.text));
    } catch (error) {
      this.#capture(error, "turn");
      await reply("Something went wrong handling that. I logged the failure.");
    } finally {
      this.#inflight.delete(conversation);
    }
  }

  #startServer(port: number): void {
    const events = this.#events();
    this.#server = Bun.serve({
      port,
      hostname: "0.0.0.0",
      fetch: (request) => this.#handleRequest(request, events),
    });
  }

  async #handleRequest(
    request: Request,
    events: GatewayEvents,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      const health = this.health();
      return Response.json(health, {
        status: health.ready ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE,
      });
    }
    if (url.pathname === "/v1/components") {
      return Response.json(this.#packages.map((item) => ({
        name: item.name,
        kind: item.kind,
        protocols: item.protocols,
      })));
    }
    const route = this.#routes.find(
      (item) => item.method === request.method && item.path === url.pathname,
    );
    if (route !== undefined) return route.handle(request, events);
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  }

  #logStarted(settings: RuntimeSettings): void {
    console.info(JSON.stringify({
      event: "elliott.runtime.started",
      environment: settings.environment,
      release: settings.release,
      skills: this.#packages.length,
      tools: this.#toolCount,
      gateways: this.#gateways.map((gateway) => gateway.name),
      services: this.#services.map((service) => service.name),
    }));
  }

  #capture(error: unknown, mechanism: string): void {
    this.#reporter?.capture(error, mechanism);
  }
}
