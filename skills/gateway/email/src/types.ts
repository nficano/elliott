export interface SmtpMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface SmtpWire {
  command(line: string, code: number): Promise<string>;
  expect(code: number): Promise<string>;
  close(): void;
}

export interface ReplyWaiter {
  readonly resolve: (reply: string) => void;
  readonly reject: (error: Error) => void;
}

export interface WireState {
  buffer: string;
  lines: string[];
  replies: string[];
  waiters: ReplyWaiter[];
  failure: Error | undefined;
}
