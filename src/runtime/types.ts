/* eslint-disable max-lines */
import type { BundledPackage } from "../catalog/types";
import type { SnapshotStore } from "../core/snapshot/snapshot";
import type { EvolutionControlPlaneBinding } from "../learning/evolution/cli";
import type { EvolutionConfig } from "../learning/evolution/config";
import type { SessionEvolutionStore } from "../memory/session-store/evolution";
import type { SessionRunEvidence } from "../memory/types";

// Where the framework built-ins load from vs. where the agent's config,
// definition, persona, custom skills, and durable state live. In a single-root
// checkout (the elliott repo itself) both point at the same directory; in an
// agent-repo deployable frameworkRoot is the installed elliott package and
// agentRoot is the pod repo.
export interface RuntimeRoots {
  readonly frameworkRoot: string;
  readonly agentRoot: string;
  readonly agentName: string;
}

export interface SecretResolver {
  env(name: string): string | undefined;
  vault(path: string, field: string): Promise<string>;
  // Optional sink the settings loader calls with each resolved SECRET value — the
  // resolved value of a secret-bearing config field (decided by the field's role)
  // and every config/secrets.yaml entry, never an ordinary referenced setting. A
  // resolver without it (the runtime boot's) records nothing; the doctor supplies
  // one to obtain its redaction set complete by construction.
  onSecret?(value: string): void;
}

export interface McpEndpointSettings {
  readonly id: string;
  readonly url: string;
  readonly transport: "streamable-http" | "sse";
  readonly authorization?: string;
}

export interface SlackSettings {
  readonly appToken: string;
  readonly botToken: string;
  readonly userToken?: string;
  readonly ownerId: string;
  readonly defaultChannel: string;
  readonly replyInThread?: boolean;
  // The Slack app's request-signing secret. When set, the gateway acquires an
  // ingress.webhook endpoint (slack-v2 profile) for HTTP interactivity.
  readonly signingSecret?: string;
}

export interface BrowserSettings {
  readonly baseUrl: string;
  readonly token: string;
  readonly allowedDomains: readonly string[];
}

export interface GmailSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  // Shared token that authenticates Pub/Sub push deliveries to the inbound
  // webhook route; the route is only registered when this is set.
  readonly webhookSecret?: string;
  // Fully-qualified Pub/Sub topic (projects/<id>/topics/<name>) the mailbox
  // watch publishes to; enables the daily users.watch renewal service.
  readonly pubsubTopic?: string;
}

export interface GoogleAccountSettings {
  readonly name: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly email?: string;
}

export interface GoogleSettings {
  readonly accounts: readonly GoogleAccountSettings[];
}

export interface BlueBubblesSettings {
  readonly serverUrl: string;
  readonly password: string;
  readonly defaultRecipient?: string;
  readonly allowedRecipients: readonly string[];
  // Shared token that authenticates BlueBubbles webhook deliveries to the
  // inbound route; the route is only registered when this is set.
  readonly webhookSecret?: string;
}

export interface FilesSettings {
  readonly root: string;
}

export interface TerminalSettings {
  readonly root: string;
  readonly allowedCommands: readonly string[];
}

export interface SshSettings {
  readonly user: string;
  readonly hosts: readonly string[];
  readonly privateKey: string;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly from: string;
  readonly allowedRecipients: readonly string[];
}

export interface HomeAssistantSettings {
  readonly baseUrl: string;
  readonly token: string;
}

export interface CloudflaredSettings {
  readonly readyUrl: string;
}

export interface PiholeSettings {
  readonly baseUrl: string;
  readonly password: string;
}

export interface TraefikSettings {
  readonly apiUrl: string;
  readonly certResolver: string;
  readonly entryPoint: string;
  // The proxy's LAN address, surfaced in proxy.route facility grants so a
  // consumer can chain a dns.local record pointing at the proxy.
  readonly lanAddress?: string;
}

// No secret and no fields: needs no credential, but bundling it in core
// means it is reachable by every agent unless an operator opts in, so
// presence of this settings object (not a bare boolean) is the gate — same
// shape as FilesSettings/TerminalSettings.
export interface SearchDuckDuckGoSettings {
  readonly enabled: true;
}

export interface WebhookProvisionerSettings {
  // Public base of the hooks hostname the cloudflared tunnel routes to the
  // runtime, e.g. https://hooks.example.com. Endpoint URLs are <base>/w/<slug>.
  readonly hooksBaseUrl: string;
}

export interface DeepTraceSettings {
  // Local hostname to publish the observability map at (dns.local +
  // proxy.route facilities), e.g. elliott.example.com.
  readonly publicHostname: string;
  // The runtime's HTTP endpoint as the reverse proxy reaches it.
  readonly serviceUrl: string;
}

export interface SubscriptionAccountSettings {
  readonly name: string;
  readonly credentials: string;
}

export interface LitellmSpendSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface SubscriptionUsageSettings {
  readonly claudeAccounts: readonly SubscriptionAccountSettings[];
  readonly codexAccounts: readonly SubscriptionAccountSettings[];
  readonly litellm?: LitellmSpendSettings;
}

export interface NewsBriefRedditSource {
  readonly multireddit: string;
  readonly intervalSeconds: number;
}

export interface NewsBriefGuardianSource {
  readonly apiKey: string;
  readonly sections: readonly string[];
  readonly intervalSeconds: number;
}

export interface NewsBriefRssFeed {
  readonly name: string;
  readonly url: string;
}

export interface NewsBriefRssSource {
  readonly feeds: readonly NewsBriefRssFeed[];
  readonly intervalSeconds: number;
}

export interface NewsBriefApiSource {
  readonly apiKey: string;
  readonly intervalSeconds: number;
}

export interface NewsBriefSettings {
  readonly keywords: readonly string[];
  readonly threshold: number;
  readonly briefSize: number;
  readonly alerts: boolean;
  readonly reddit?: NewsBriefRedditSource;
  readonly guardian?: NewsBriefGuardianSource;
  readonly rss?: NewsBriefRssSource;
  readonly newsdata?: NewsBriefApiSource;
  readonly gnews?: NewsBriefApiSource;
}

export interface GovernanceSettings {
  // Tool names the policy refuses outright. Governance is default-allow so the
  // existing tool set keeps working; a denied tool still appears to the model
  // but every invocation is refused and audited. Centralizes what used to be
  // ad-hoc per-skill guards.
  readonly deny: readonly string[];
  // Bearer token for the /v1/control/governance kill-switch route. When unset
  // the route is not exposed; policy evaluation and the audit trail still run.
  readonly controlToken?: string;
}

export interface RuntimeEvolutionSettings {
  readonly controlToken: string;
  readonly operatorPrincipalId: string;
  readonly operatorCapabilities: readonly string[];
  readonly agentCapabilities: readonly string[];
  readonly dspyEndpoint?: string;
  readonly darwinianEndpoint?: string;
  readonly evaluatorEndpoint?: string;
  readonly evaluatorToken?: string;
  readonly candidateCheckEndpoint?: string;
  readonly canaryEndpoint?: string;
  readonly authoringRouteDigest?: string;
  readonly evaluationRouteDigest?: string;
  readonly schedulerPrincipalId?: string;
  readonly schedulerCapabilities: readonly string[];
}

export interface RuntimeEvolutionIntegration {
  readonly controlPlane: EvolutionControlPlaneBinding;
  readonly agentTools: readonly ToolDefinition[];
  readonly decorateTools: (
    tools: readonly ToolDefinition[],
  ) => readonly ToolDefinition[];
  readonly decoratePersona: (
    personaPath: string,
    baselineContent: string,
  ) => () => string;
  readonly targetsForTool: (
    toolName: string,
  ) => readonly RuntimeEvolutionTargetIdentity[];
  readonly turnTargets: () => readonly RuntimeEvolutionTargetIdentity[];
  readonly continuousService?: RuntimeContinuousEvolutionService;
}

export interface RuntimeEvolutionTargetIdentity {
  readonly targetRef: string;
  readonly digest: string;
}

export interface RuntimeEvolutionEvidenceInput {
  readonly sink: Pick<
    SessionEvolutionStore,
    | "recordRun"
    | "finishRun"
    | "recordToolCall"
    | "recordComponentUse"
    | "recordFeedback"
    | "recordModelSelection"
  >;
  readonly targetsForTool: (
    toolName: string,
  ) => readonly RuntimeEvolutionTargetIdentity[];
  readonly turnTargets: () => readonly RuntimeEvolutionTargetIdentity[];
  readonly toolNames: readonly string[];
  readonly report: (error: unknown) => void;
  readonly now?: () => Date;
  readonly newId?: (prefix: string) => string;
}

export interface RuntimeEvolutionTurnEvidence {
  readonly runId: string;
  readonly observer: TurnObserver;
  finish(disposition: SessionRunEvidence["disposition"]): void;
}

export interface RuntimeContinuousEvolutionService {
  readonly name: "evolution-continuous";
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Readonly<Record<string, number>>;
}

export interface RuntimeSnapshotInput {
  readonly store: SnapshotStore;
  readonly settings: RuntimeSettings;
  readonly packages: readonly BundledPackage[];
  readonly root: string;
}

export interface RuntimeSettings {
  readonly environment: string;
  readonly release: string;
  readonly timezone: string;
  readonly port: number;
  readonly persona: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly llmBaseUrl: string;
  readonly llmWire: LlmWire;
  readonly llmApiKey: string;
  readonly thinking?: LlmThinking;
  readonly effort?: LlmEffort;
  readonly stateDirectory: string;
  readonly browser: BrowserSettings;
  readonly braveApiKey?: string;
  readonly firecrawlApiKey?: string;
  readonly parallelApiKey?: string;
  readonly searchDuckduckgo?: SearchDuckDuckGoSettings;
  readonly slack?: SlackSettings;
  readonly gmail?: GmailSettings;
  readonly google?: GoogleSettings;
  readonly bluebubbles?: BlueBubblesSettings;
  readonly files?: FilesSettings;
  readonly terminal?: TerminalSettings;
  readonly ssh?: SshSettings;
  readonly smtp?: SmtpSettings;
  readonly homeAssistant?: HomeAssistantSettings;
  readonly cloudflared?: CloudflaredSettings;
  readonly pihole?: PiholeSettings;
  readonly traefik?: TraefikSettings;
  readonly webhookProvisioner?: WebhookProvisionerSettings;
  readonly deepTrace?: DeepTraceSettings;
  readonly subscriptionUsage?: SubscriptionUsageSettings;
  // The internal loopback-hop signing secret: webhook-provisioner signs
  // verified deliveries with it before forwarding to a consumer's internal
  // route, and consumers (e.g. gateway-slack's interactivity route) verify
  // it back. Not gateway-webhook's secret — see webhookGatewaySecret below;
  // the two must stay independent so provisioning one never activates the
  // other's unrelated public route.
  readonly webhookSecret?: string;
  // gateway-webhook's own HMAC secret for its standalone public
  // /v1/gateways/webhook route. Deliberately distinct from webhookSecret.
  readonly webhookGatewaySecret?: string;
  readonly mcp: readonly McpEndpointSettings[];
  readonly glitchtip?: GlitchTipSettings;
  readonly vault?: VaultSettings;
  readonly postgresDsn?: string;
  readonly newsBrief?: NewsBriefSettings;
  // Raw resolved `skills:` config subtree. Agent-local skills (loaded from
  // agents/<name>/skills/) own their config schemas and decode their blocks
  // from here; framework and registry skills use the typed fields above.
  readonly skillConfig?: Readonly<Record<string, unknown>>;
  readonly evolution?: EvolutionConfig;
  readonly evolutionRuntime?: RuntimeEvolutionSettings;
  readonly governance?: GovernanceSettings;
  // Installable skills resolved from the nficano/skills registry. Absent when
  // no `install:` block is configured. See docs/explanation/skills-registry.md.
  readonly install?: InstallSettings;
}

export interface InstallEntrySettings {
  readonly name: string;
  readonly version?: string;
  readonly required: boolean;
}

export interface InstallSettings {
  readonly registry: string;
  readonly refresh: boolean;
  readonly skills: readonly InstallEntrySettings[];
}

// One line of the /healthz install section: whether each requested skill
// resolved, and from where. A required skill that is not `ok` flips readiness.
export interface InstallHealth {
  readonly skill: string;
  readonly requested: string;
  readonly resolved?: string;
  readonly state: "ok" | "cached-fallback" | "failed";
  readonly required: boolean;
  readonly error?: string;
}

// The provider an operator names in `llm.provider`. Resolving one yields an
// LlmEndpoint; the provider name itself never reaches the runtime.
export type LlmProvider = "anthropic" | "openai";

// The wire protocol spoken at an endpoint. "openai" is POST
// /chat/completions with a Bearer key; "anthropic" is POST /messages with
// x-api-key and the native message/content-block shape.
export type LlmWire = "anthropic" | "openai";

export interface LlmEndpoint {
  readonly baseUrl: string;
  readonly wire: LlmWire;
}

// Reasoning controls, passed through to whichever wire is in force. Both are
// optional: unset means the model's own default, which is the only setting
// that stays correct as providers change those defaults per model.
export type LlmThinking = "adaptive" | "disabled";

export type LlmEffort = "high" | "low" | "max" | "medium" | "xhigh";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly resultRetention?: "conversation" | "turn";
  execute(input: unknown, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ModelMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly ephemeral?: boolean;
}

export interface ModelTurnResult {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage?: RuntimeModelUsage;
  readonly selection?: RuntimeModelSelection;
}

export interface RuntimeModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface RuntimeModelSelection {
  readonly routeDigest: string;
  readonly usageReference: string;
}

export interface ModelTurnRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly allowTools: boolean;
}

// Inactivity budget for LiteLLM calls: initial covers time-to-first-byte (a
// non-streaming completion generates fully before answering); every streamed
// chunk then resets the shorter inactivity allowance.
export interface ModelCallTimeouts {
  readonly initialMilliseconds: number;
  readonly inactivityMilliseconds: number;
}

export interface ModelCallWatchdog {
  readonly signal: AbortSignal;
  readonly touch: () => void;
  readonly stop: () => void;
}

export interface RuntimeModelCompleter {
  readonly complete: (
    request: ModelTurnRequest,
    onTextDelta?: (delta: string) => Promise<void>,
  ) => Promise<ModelTurnResult>;
}

// The error data the reporter hands a sink to transmit OFF-BOX. It structurally
// omits the error message. The message is the one field a developer can
// interpolate a secret into (`throw new Error(`… ${secret}`)`), so it never
// crosses the process boundary — only these fields do, and none of them can
// carry an interpolated runtime value:
//   - name    : the error class (constructor name), an identity, not a value.
//   - frames  : stack FRAMES only — the `at fn (file:line:col)` lines, never the
//               `Error: <message>` header — i.e. code locations, not data.
//   - mechanism: a code-controlled routing label (turn / gateway:<name> /
//               skill:<name>), composed of framework/manifest identifiers.
//   - timestamp: generated here.
// Because none of these hold interpolated text, a sink transmitting only a
// TransmittableError cannot exfiltrate a secret, and no redaction is required.
// The full message (with any secret) stays in the LOCAL console — which does not
// cross the process boundary. See src/runtime/reporter.ts and skills/glitchtip.
export interface TransmittableError {
  readonly name: string;
  readonly frames: readonly string[];
  readonly mechanism: string;
  readonly timestamp: string;
}

// A destination the error reporter fans captured failures out to. Installed by
// a skill (see SkillContext.installErrorSink); the core reporter knows only this
// interface, never a concrete transport. It receives a TransmittableError, which
// by construction carries no free-form message — so a sink cannot leak a secret
// it was never handed.
export interface ErrorSink {
  capture(event: TransmittableError): void;
}

// Error reporting configuration, resolved at the config boundary. Presence
// means reporting is enabled; `dsn` is either the operator's own Sentry/
// GlitchTip DSN or, with zero wiring, the bundled collector companion's
// address. The DSN is opaque here and never enters a transmitted payload — it
// rides only on the POST target and auth header.
export interface GlitchTipSettings {
  readonly dsn: string;
}

// HashiCorp Vault access for the (default-off) vault skill. `paths` is a
// fail-closed KV allowlist: a vault skill with no readable paths does not
// register, mirroring the ssh host-allowlist doctrine. The token is an opaque
// reference resolved at the config boundary and never logged or returned.
export interface VaultSettings {
  readonly address: string;
  readonly token: string;
  readonly paths: readonly string[];
}

export interface InboundContextEntity {
  readonly type: string;
  readonly value: string | Readonly<Record<string, string>>;
  readonly teamId?: string;
}

export interface InboundAttachment {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
}

export interface InboundThreadMessage {
  readonly sender: string;
  readonly text: string;
}

export interface InboundMessage {
  readonly id: string;
  readonly gateway: string;
  readonly channel: string;
  readonly thread?: string;
  readonly threadRoot?: boolean;
  readonly platformId?: string;
  readonly sender: string;
  readonly text: string;
  readonly team?: string;
  readonly actionToken?: string;
  readonly context?: readonly InboundContextEntity[];
  readonly attachments?: readonly InboundAttachment[];
  readonly history?: readonly InboundThreadMessage[];
  readonly historyMode?: "runtime" | "external";
}

// Identity behind a tool invocation. `agent` is which agent owns this runtime
// (multiple agents may share one chat app, so per-agent attribution is the
// only way to tell their actions apart in the audit trail); the remaining
// fields describe the human/external actor that triggered the turn, when known.
export interface GovernancePrincipal {
  readonly agent: string;
  readonly actor?: string;
  readonly gateway?: string;
  readonly channel?: string;
}

export interface ToolExecutionContext {
  readonly message?: InboundMessage;
  // Populated by the runtime on every turn; the governance layer attributes
  // audit records to it and skills may read it for their own checks.
  readonly principal?: GovernancePrincipal;
}

export interface TurnToolProgress {
  readonly id: string;
  readonly name: string;
  readonly status: "in_progress" | "complete" | "error";
  readonly requestedTool?: string;
  readonly selectedTool?: string;
  readonly schemaDigest?: string;
  readonly argumentsDigest?: string;
  readonly resultDigest?: string;
  readonly errorTag?: string;
}

export interface TurnObserver {
  readonly onTextDelta?: (delta: string) => Promise<void>;
  readonly onToolProgress?: (progress: TurnToolProgress) => Promise<void>;
  readonly onModelSelection?: (
    selection: RuntimeModelSelection,
  ) => Promise<void>;
  // Fires once per round with the fully assembled request (system prompt +
  // messages + tools) immediately before the provider call. This is the only
  // seam where the raw prompt is observable; used by the telemetry bus so an
  // operator can watch the prompt that is relayed to the model.
  readonly onModelRequest?: (request: ModelTurnRequest) => Promise<void>;
}

// --- In-process telemetry (observability map) ---------------------------------
// A cheap, always-on pub/sub surface that mirrors turn activity to local
// subscribers (the deep-trace extension). It never persists and never leaves
// the process; durable evidence still lives in sessions.sqlite.

export type TelemetryEventType =
  | "inbound"
  | "turn.begin"
  | "model.request"
  | "model.selection"
  | "tool.progress"
  | "turn.finish"
  | "db.write"
  | "error"
  | "evolution"
  | "heartbeat";

export interface TelemetryEnvelope {
  readonly seq: number;
  readonly at: string;
  readonly type: TelemetryEventType;
  readonly runId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type TelemetrySubscriber = (event: TelemetryEnvelope) => void;

export interface TelemetryBus {
  readonly promptsEnabled: boolean;
  emit(
    type: TelemetryEventType,
    payload: Readonly<Record<string, unknown>>,
    runId?: string,
  ): void;
  subscribe(subscriber: TelemetrySubscriber): () => void;
  recent(): readonly TelemetryEnvelope[];
}

export interface TurnOptions {
  readonly observer?: TurnObserver;
  readonly context?: ToolExecutionContext;
  readonly retainHistory?: boolean;
}

// Per-turn tool-execution context threaded through each round. `repeats`
// counts identical calls (tool name + arguments digest) within one turn so
// the agent can surface a repeated-call notice instead of silently burning
// rounds on a stuck loop.
export interface ToolRoundContext {
  readonly options: TurnOptions;
  readonly tools: ReadonlyMap<string, ToolDefinition>;
  readonly repeats: Map<string, number>;
}

export interface RuntimeHealth {
  readonly ready: boolean;
  readonly release: string;
  readonly skills: number;
  readonly tools: number;
  readonly gateways: Readonly<Record<string, string>>;
  readonly services: Readonly<Record<string, Readonly<Record<string, number>>>>;
  // Present only when an `install:` block is configured; one entry per requested
  // installable skill.
  readonly install?: readonly InstallHealth[];
}

export interface RuntimeStartedEvent {
  readonly environment: string;
  readonly release: string;
  readonly skills: number;
  readonly tools: number;
  readonly gateways: readonly string[];
  readonly services: readonly string[];
}

// How the runtime HTTP handler should dispatch a request. `resolveRuntimeRoute`
// computes this from the method + path and which optional control planes are
// mounted; `#handleRequest` switches on `kind` to build the response. `route`
// carries the matched index into the live route table.
export type RuntimeRouteResolution =
  | { readonly kind: "health"; }
  | { readonly kind: "components"; }
  | { readonly kind: "evolution-control"; }
  | { readonly kind: "governance-control"; }
  | { readonly kind: "route"; readonly index: number; }
  | { readonly kind: "not-found"; };
