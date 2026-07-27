/* eslint-disable max-lines */
import type { BundledPackage } from "../catalog/types";
import type { SnapshotStore } from "../core/snapshot/snapshot";
import type { EvolutionControlPlaneBinding } from "../learning/evolution/cli";
import type { EvolutionConfig } from "../learning/evolution/config";
import type { SessionEvolutionStore } from "../memory/session-store/evolution";
import type { SessionRunEvidence } from "../memory/types";

export interface SecretResolver {
  env(name: string): string | undefined;
  vault(path: string, field: string): Promise<string>;
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
}

export interface BlueBubblesSettings {
  readonly serverUrl: string;
  readonly password: string;
  readonly defaultRecipient?: string;
  readonly allowedRecipients: readonly string[];
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

export interface PakmanSettings {
  readonly username: string;
  readonly password: string;
}

export interface YouTubeOAuthSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface YouTubeDvrProviderRef {
  readonly name: string;
  readonly days: readonly string[];
}

export interface YouTubeDvrSettings {
  readonly oauth: YouTubeOAuthSettings;
  readonly channels: readonly string[];
  readonly providers: readonly YouTubeDvrProviderRef[];
  readonly timezone: string;
  readonly windowStartHour: number;
  readonly windowEndHour: number;
  readonly lookbackSeconds: number;
  readonly minDurationSeconds: number;
  readonly pollIntervalSeconds: number;
  readonly playlistTitleTemplate: string;
  readonly playlistPrivacy: string;
  readonly tool: boolean;
}

export interface RuntimeEvolutionSettings {
  readonly controlToken: string;
  readonly operatorPrincipalId: string;
  readonly operatorCapabilities: readonly string[];
  readonly agentCapabilities: readonly string[];
  readonly dspyEndpoint?: string;
  readonly darwinianEndpoint?: string;
  readonly evaluatorEndpoint?: string;
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
  readonly llmApiKey: string;
  readonly stateDirectory: string;
  readonly browser: BrowserSettings;
  readonly braveApiKey?: string;
  readonly firecrawlApiKey?: string;
  readonly parallelApiKey?: string;
  readonly slack?: SlackSettings;
  readonly gmail?: GmailSettings;
  readonly bluebubbles?: BlueBubblesSettings;
  readonly files?: FilesSettings;
  readonly terminal?: TerminalSettings;
  readonly ssh?: SshSettings;
  readonly smtp?: SmtpSettings;
  readonly homeAssistant?: HomeAssistantSettings;
  readonly cloudflared?: CloudflaredSettings;
  readonly webhookSecret?: string;
  readonly mcp: readonly McpEndpointSettings[];
  readonly glitchtipDsn?: string;
  readonly postgresDsn?: string;
  readonly newsBrief?: NewsBriefSettings;
  readonly pakman?: PakmanSettings;
  readonly youtubeDvr?: YouTubeDvrSettings;
  readonly evolution?: EvolutionConfig;
  readonly evolutionRuntime?: RuntimeEvolutionSettings;
}

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

export interface RuntimeModelCompleter {
  readonly complete: (
    request: ModelTurnRequest,
    onTextDelta?: (delta: string) => Promise<void>,
  ) => Promise<ModelTurnResult>;
}

export interface GlitchTipTarget {
  readonly endpoint: string;
  readonly publicKey: string;
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

export interface ToolExecutionContext {
  readonly message?: InboundMessage;
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
// subscribers (the telemetry-map extension). It never persists and never leaves
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

export interface RuntimeHealth {
  readonly ready: boolean;
  readonly release: string;
  readonly skills: number;
  readonly tools: number;
  readonly gateways: Readonly<Record<string, string>>;
  readonly services: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface RuntimeStartedEvent {
  readonly environment: string;
  readonly release: string;
  readonly skills: number;
  readonly tools: number;
  readonly gateways: readonly string[];
  readonly services: readonly string[];
}
