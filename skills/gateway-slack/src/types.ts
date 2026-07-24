import type {
  InboundContextEntity,
  InboundMessage,
} from "../../../src/runtime/types";

export type SlackJson = Readonly<Record<string, unknown>>;

export interface SlackApiClient {
  request(method: string, body?: SlackJson): Promise<SlackJson>;
}

export interface SlackClientOptions {
  readonly token: string;
  readonly fetcher?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface SlackClientSet {
  readonly app: SlackApiClient;
  readonly bot: SlackApiClient;
  readonly user?: SlackApiClient;
}

export interface SlackSocket {
  send(value: string): void;
  close(): void;
}

export interface SlackSocketHandlers {
  readonly onMessage: (value: string) => void;
  readonly onClose: () => void;
}

export type SlackSocketFactory = (
  url: string,
  handlers: SlackSocketHandlers,
) => Promise<SlackSocket>;

export interface SlackGatewayDependencies {
  readonly clients: SlackClientSet;
  readonly report: (error: unknown, mechanism: string) => void;
  readonly openSocket?: SlackSocketFactory;
}

export interface SlackAgentResponseOptions {
  readonly client: SlackApiClient;
  readonly message: InboundMessage;
  readonly report: (error: unknown, mechanism: string) => void;
}

export interface SlackAppHomeOptions {
  readonly client: SlackApiClient;
  readonly channel: string;
  readonly context: readonly InboundContextEntity[];
}

export type SlackInteraction =
  | {
    readonly type: "feedback";
    readonly channel: string;
    readonly message: string;
    readonly sender: string;
    readonly sentiment: "positive" | "negative";
  }
  | {
    readonly type: "delete";
    readonly channel: string;
    readonly message: string;
    readonly sender: string;
  };

export interface DecodedSlackEvent {
  readonly message?: InboundMessage;
  readonly context?: readonly InboundContextEntity[];
}
