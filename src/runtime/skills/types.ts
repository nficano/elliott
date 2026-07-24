import type {
  InboundMessage,
  RuntimeSettings,
  ToolDefinition,
  TurnObserver,
} from "../types";

export interface GatewayFeedback {
  readonly gateway: string;
  readonly channel: string;
  readonly message: string;
  readonly sender: string;
  readonly sentiment: "positive" | "negative";
  readonly source: "button" | "reaction";
}

export interface GatewayEvents {
  readonly onMessage: (message: InboundMessage) => Promise<void>;
  readonly onFeedback: (feedback: GatewayFeedback) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export interface GatewayResponse {
  readonly observer?: TurnObserver;
  complete(text: string): Promise<void>;
  fail(message: string): Promise<void>;
}

export interface GatewayBinding {
  readonly name: string;
  readonly defaultChannel?: string;
  status(): string;
  start(events: GatewayEvents): Promise<void>;
  send?(channel: string, text: string, thread?: string): Promise<void>;
  beginResponse?(message: InboundMessage): Promise<GatewayResponse>;
  stop(): void | Promise<void>;
}

export interface RouteBinding {
  readonly method: string;
  readonly path: string;
  handle(request: Request, events: GatewayEvents): Promise<Response>;
}

export interface ServiceBinding {
  readonly name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  health?(): Readonly<Record<string, number>>;
}

export interface SkillContext {
  readonly settings: RuntimeSettings;
  readonly stateDirectory: string;
  report(error: unknown, mechanism: string): void;
  deliver(text: string): Promise<void>;
}

export interface SkillRegistration {
  readonly tools?: readonly ToolDefinition[];
  readonly gateways?: readonly GatewayBinding[];
  readonly routes?: readonly RouteBinding[];
  readonly services?: readonly ServiceBinding[];
}

export type SkillRegistrar = (
  context: SkillContext,
) => Promise<SkillRegistration> | SkillRegistration;

export interface LoadedSkill {
  readonly name: string;
  readonly registration: SkillRegistration;
}
