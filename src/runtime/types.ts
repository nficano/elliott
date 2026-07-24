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
}

export interface ModelTurnRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly allowTools: boolean;
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
}

export interface TurnObserver {
  readonly onTextDelta?: (delta: string) => Promise<void>;
  readonly onToolProgress?: (progress: TurnToolProgress) => Promise<void>;
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
