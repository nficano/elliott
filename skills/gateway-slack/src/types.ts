export type SlackJson = Readonly<Record<string, unknown>>;

export interface SlackSocket {
  send(value: string): void;
  close(): void;
}

export interface SlackSocketHandlers {
  readonly onMessage: (value: string) => void;
  readonly onClose: () => void;
}
