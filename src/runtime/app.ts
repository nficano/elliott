/* eslint-disable max-lines */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  loadAgentSkillPackages,
  loadBundledPackages,
} from "../catalog/bundled";
import type { BundledPackage } from "../catalog/types";
import type { AgentKernel } from "../kernel";
import type { EvolutionControlPlaneBinding } from "../learning/evolution/cli";
import { SessionStore } from "../memory/session-store/index";
import { isJsonRecord } from "../providers/http";
import { RuntimeAgent } from "./agent";
import { loadRuntimeSettings } from "./config";
import { RuntimeConversationSnapshots } from "./conversation-snapshots";
import { makeRuntimeEvolutionIntegration } from "./evolution";
import { RuntimeEvolutionEvidence } from "./evolution-evidence";
import {
  CapabilityGate,
  GovernancePolicy,
  makeGovernanceControlPlane,
  ToolGovernor,
} from "./governance/index";
import type { GovernanceControlPlaneBinding } from "./governance/index";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "./http";
import { makeRuntimeKernel } from "./kernel";
import { logRuntimeStarted } from "./logging";
import { RuntimeModelClient } from "./model/client";
import { RuntimeErrorReporter } from "./reporter";
import { runtimeComponentSummary, startRuntimeServer } from "./server";
import {
  collectGateways,
  collectPackageViews,
  collectRoutes,
  collectServices,
  collectTools,
  loadSkillRegistrations,
} from "./skills/loader";
import type {
  GatewayBinding,
  GatewayEvents,
  GatewayFeedback,
  GatewayResponse,
  RouteBinding,
  ServiceBinding,
  SkillContextSeed,
  SkillPackageView,
} from "./skills/types";
import { ensureRuntimeSnapshot } from "./snapshot";
import { runtimeTelemetry, telemetryTurnObserver } from "./telemetry";
import type {
  GovernancePrincipal,
  InboundMessage,
  RuntimeHealth,
  RuntimeRoots,
  RuntimeSettings,
  ToolDefinition,
} from "./types";

const resolveRoots = (roots: string | RuntimeRoots): RuntimeRoots =>
  typeof roots === "string"
    ? { frameworkRoot: roots, agentRoot: roots, agentName: "elliott" }
    : roots;

// Resource extractor for the SSH capability gate: the broker denies the call
// unless this host is covered by the seeded grant (the configured allowlist).
const sshHost = (input: unknown): string => {
  if (isJsonRecord(input) && typeof input["host"] === "string") {
    return input["host"];
  }
  throw new Error("ssh_exec requires a host");
};

export class ElliottRuntime {
  readonly #frameworkRoot: string;
  readonly #agentRoot: string;
  readonly #agentName: string;
  readonly #kernel: AgentKernel;
  #evolutionControlPlane: EvolutionControlPlaneBinding | undefined;
  #snapshotId: string | undefined;
  #settings: RuntimeSettings | undefined;
  #evidenceStore: SessionStore | undefined;
  #evolutionEvidence: RuntimeEvolutionEvidence | undefined;
  #packages: readonly BundledPackage[] = [];
  #packageViews: readonly SkillPackageView[] = [];
  #gateways: readonly GatewayBinding[] = [];
  #routes: readonly RouteBinding[] = [];
  #services: readonly ServiceBinding[] = [];
  #agent: RuntimeAgent | undefined;
  #governanceControlPlane: GovernanceControlPlaneBinding | undefined;
  #reporter: RuntimeErrorReporter | undefined;
  #server: ReturnType<typeof Bun.serve> | undefined;
  #ready = false;
  #toolCount = 0;
  readonly #seen = new Set<string>();
  readonly #inflight = new Set<string>();
  readonly #conversationSnapshots = new RuntimeConversationSnapshots();

  constructor(
    roots: string | RuntimeRoots,
    evolutionControlPlane?: EvolutionControlPlaneBinding,
  ) {
    const { frameworkRoot, agentRoot, agentName } = resolveRoots(roots);
    this.#frameworkRoot = frameworkRoot;
    this.#agentRoot = agentRoot;
    this.#agentName = agentName;
    // Kernel snapshots, evolution state, and durable evidence all belong to
    // the agent, so the kernel is rooted at the agent checkout.
    this.#kernel = makeRuntimeKernel(agentRoot);
    this.#evolutionControlPlane = evolutionControlPlane;
  }

  // Boot is deliberately ordered: kernel, static packages, immutable
  // Snapshot, evolution bindings, then externally reachable routes.
  // eslint-disable-next-line max-lines-per-function, max-statements, complexity
  async start(): Promise<void> {
    const settings = await loadRuntimeSettings(
      this.#agentRoot,
      this.#agentName,
    );
    this.#settings = settings;
    await mkdir(settings.stateDirectory, { recursive: true });
    this.#evidenceStore = new SessionStore(
      path.join(settings.stateDirectory, "sessions.sqlite"),
    );
    this.#reporter = new RuntimeErrorReporter(
      settings.glitchtipDsn,
      settings.environment,
      settings.release,
    );
    await this.#kernel.start();
    this.#packages = [
      ...await loadBundledPackages(this.#frameworkRoot),
      // The agent's own custom skills load through the same package seam;
      // duplicate tool names across the two roots fail fast in collectTools.
      ...await loadAgentSkillPackages(this.#agentRoot, this.#agentName),
    ];
    const skills = await loadSkillRegistrations(
      this.#packages,
      this.#skillContext(settings),
    );
    this.#packageViews = collectPackageViews(this.#packages, skills);
    const baseTools = collectTools(skills);
    this.#gateways = collectGateways(skills);
    this.#routes = collectRoutes(skills);
    this.#services = collectServices(skills);
    const snapshot = await ensureRuntimeSnapshot({
      store: this.#kernel.snapshots,
      settings,
      packages: this.#packages,
      root: this.#agentRoot,
    });
    this.#snapshotId = snapshot.id;
    const evolution = this.#evolutionControlPlane === undefined
      ? await makeRuntimeEvolutionIntegration(
        this.#agentRoot,
        settings,
        this.#kernel,
        () => this.#snapshotId,
        (snapshotId) => {
          this.#snapshotId = snapshotId;
        },
        baseTools,
        (message) => this.#deliver(message),
      )
      : undefined;
    if (evolution !== undefined) {
      this.#evolutionControlPlane = evolution.controlPlane;
      if (evolution.continuousService !== undefined) {
        this.#services = [...this.#services, evolution.continuousService];
      }
    }
    // High-risk tools (SSH) route through the real CapabilityBroker for
    // default-deny per-resource enforcement; then governance wraps the whole
    // set so every model-issued call is policy-checked, attributed, and audited
    // at one chokepoint. Names are preserved, so evidence and the model see the
    // same tool surface.
    const gated = this.#installCapabilityGates(settings, [
      ...(evolution?.decorateTools(baseTools) ?? baseTools),
      ...(evolution?.agentTools ?? []),
    ]);
    const tools = this.#installGovernance(settings, gated);
    this.#evolutionEvidence = new RuntimeEvolutionEvidence({
      sink: this.#evidenceStore.evolution,
      targetsForTool: evolution?.targetsForTool ?? (() => []),
      turnTargets: evolution?.turnTargets ?? (() => []),
      toolNames: tools.map((tool) => tool.name),
      report: (error) => this.#capture(error, "evolution-evidence"),
    });
    this.#toolCount = tools.length;
    const persona = await readFile(settings.persona, "utf8");
    this.#agent = new RuntimeAgent(
      new RuntimeModelClient(settings),
      evolution?.decoratePersona(settings.persona, persona) ?? persona,
      tools,
    );
    await this.#startBindings();
    const events = this.#events();
    this.#server = startRuntimeServer(
      settings.port,
      (request) => this.#handleRequest(request, events),
    );
    this.#ready = true;
    logRuntimeStarted({
      environment: settings.environment,
      release: settings.release,
      skills: this.#packages.length,
      tools: this.#toolCount,
      gateways: this.#gateways.map((gateway) => gateway.name),
      services: this.#services.map((service) => service.name),
    });
  }

  async stop(): Promise<void> {
    this.#ready = false;
    for (const gateway of this.#gateways) await gateway.stop();
    for (const service of this.#services) await service.stop();
    await this.#server?.stop();
    await this.#kernel.stop();
    this.#evidenceStore?.close();
    this.#evidenceStore = undefined;
    this.#evolutionEvidence = undefined;
    this.#snapshotId = undefined;
    this.#conversationSnapshots.clear();
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

  // Builds the tool governor over the kernel's durable audit log, opens the
  // kill-switch route when a control token is configured, and returns the
  // governed tool set. Default-allow: the value here is attribution + a
  // tamper-evident trail + the runtime disable, not an allow-list of every tool.
  #installGovernance(
    settings: RuntimeSettings,
    tools: readonly ToolDefinition[],
  ): readonly ToolDefinition[] {
    const governor = new ToolGovernor({
      agent: this.#agentName,
      records: this.#kernel.records,
      policy: new GovernancePolicy({ deny: settings.governance?.deny ?? [] }),
      report: (error, mechanism) => this.#capture(error, mechanism),
    });
    const token = settings.governance?.controlToken;
    if (token !== undefined) {
      this.#governanceControlPlane = makeGovernanceControlPlane(
        governor,
        token,
      );
    }
    return governor.decorate(tools);
  }

  // Routes the SSH tool through the kernel CapabilityBroker with a grant scoped
  // to exactly the configured host allowlist. Behavior-preserving: the granted
  // resources equal the skill's own allowlist, so any host the skill would run
  // also passes the broker, while a non-allowlisted host is denied one layer
  // earlier (and audited as broker.dispatch) before the skill's guard runs.
  #installCapabilityGates(
    settings: RuntimeSettings,
    tools: readonly ToolDefinition[],
  ): readonly ToolDefinition[] {
    const ssh = settings.ssh;
    if (ssh === undefined) return tools;
    const gate = new CapabilityGate({
      broker: this.#kernel.broker,
      grants: this.#kernel.grants,
      agent: this.#agentName,
    }, {
      tool: "ssh_exec",
      capability: "ssh.exec",
      resources: ssh.hosts,
      resolveResource: sshHost,
    });
    return gate.decorate(tools);
  }

  #principal(message: InboundMessage): GovernancePrincipal {
    return {
      agent: this.#agentName,
      actor: message.sender,
      gateway: message.gateway,
      channel: message.channel,
    };
  }

  #skillContext(settings: RuntimeSettings): SkillContextSeed {
    return {
      settings,
      stateDirectory: path.join(this.#agentRoot, ".elliott-runtime"),
      // Lazy on purpose: the views are collected right after registration, so
      // register()-time callers see an empty list while routes and services
      // (which only run post-boot) see every package.
      packages: () => this.#packageViews,
      report: (error, mechanism) => this.#capture(error, mechanism),
      deliver: (text) => this.#deliver(text),
    };
  }

  #events(): GatewayEvents {
    return {
      onMessage: (message) => this.#handleInbound(message),
      onFeedback: (feedback) => this.#handleFeedback(feedback),
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

  // eslint-disable-next-line max-lines-per-function, max-statements, complexity
  async #handleInbound(message: InboundMessage): Promise<void> {
    if (this.#seen.has(message.id)) return;
    this.#seen.add(message.id);
    const turnId = `turn:${crypto.randomUUID()}`;
    runtimeTelemetry.emit("inbound", {
      messageId: message.id,
      gateway: message.gateway,
      channel: message.channel,
      sender: message.sender,
      textLength: message.text.length,
      // Message content follows the same visibility gate as assembled prompts.
      ...(runtimeTelemetry.promptsEnabled && { text: message.text }),
    }, turnId);
    const gateway = this.#replyGateway(message);
    const response = await this.#beginResponse(gateway, message);
    const conversation = `${message.gateway}:${message.channel}:${
      message.thread ?? "root"
    }`;
    if (this.#inflight.has(conversation)) {
      await response.complete(
        "One moment—I’m still working on your previous message.",
      );
      return;
    }
    const agent = this.#agent;
    if (agent === undefined) throw new Error("Runtime agent is not ready");
    const snapshotId = this.#snapshotId;
    if (snapshotId === undefined) throw new Error("Runtime Snapshot is absent");
    const retainConversation = message.historyMode !== "external";
    const pinnedSnapshotId = this.#conversationSnapshots.resolve(
      conversation,
      snapshotId,
      retainConversation,
    );
    this.#inflight.add(conversation);
    const evidence = this.#evolutionEvidence?.beginTurn({
      conversation,
      channelKey: `${message.gateway}:${message.channel}`,
      snapshotId: pinnedSnapshotId,
      retainConversation,
      ...(response.observer !== undefined && { observer: response.observer }),
    });
    const observer = telemetryTurnObserver(evidence?.observer, turnId);
    runtimeTelemetry.emit("turn.begin", {
      conversation,
      snapshotId: pinnedSnapshotId,
    }, turnId);
    try {
      const answer = await agent.turn(conversation, message.text, {
        observer,
        context: { message, principal: this.#principal(message) },
        retainHistory: retainConversation,
      });
      await response.complete(answer);
      evidence?.finish("success");
      runtimeTelemetry.emit("turn.finish", {
        disposition: "success",
        answerLength: answer.length,
        ...(runtimeTelemetry.promptsEnabled && { answer }),
      }, turnId);
    } catch (error) {
      evidence?.finish("failure");
      runtimeTelemetry.emit("turn.finish", { disposition: "failure" }, turnId);
      this.#capture(error, "turn");
      await response.fail(
        "Something went wrong handling that. I logged the failure.",
      );
    } finally {
      this.#inflight.delete(conversation);
    }
  }

  async #handleFeedback(feedback: GatewayFeedback): Promise<void> {
    this.#evolutionEvidence?.recordFeedback(feedback);
  }

  async #beginResponse(
    gateway: GatewayBinding | undefined,
    message: InboundMessage,
  ): Promise<GatewayResponse> {
    if (gateway?.beginResponse !== undefined) {
      try {
        return await gateway.beginResponse(message);
      } catch (error) {
        this.#capture(error, `gateway:${gateway.name}:response`);
      }
    }
    const deliver = async (text: string): Promise<void> => {
      await gateway?.send?.(message.channel, text, message.thread);
    };
    return { complete: deliver, fail: deliver };
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
      return Response.json(runtimeComponentSummary(this.#packages));
    }
    if (
      url.pathname === "/v1/control/evolution"
      && this.#evolutionControlPlane !== undefined
    ) return this.#evolutionControlPlane.handle(request);
    if (
      url.pathname === "/v1/control/governance"
      && this.#governanceControlPlane !== undefined
    ) return this.#governanceControlPlane.handle(request);
    const route = this.#routes.find(
      (item) => item.method === request.method && item.path === url.pathname,
    );
    if (route !== undefined) return route.handle(request, events);
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  }

  #capture(error: unknown, mechanism: string): void {
    this.#reporter?.capture(error, mechanism);
  }
}
