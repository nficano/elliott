import type { Socket } from "bun";
import type { SmtpSettings } from "../../../../src/runtime/types";
import type { SmtpMessage, SmtpWire, WireState } from "./types";

const REPLY_TIMEOUT_MILLISECONDS = 15_000;
const GREETING = 220;
const OKAY = 250;
const AUTHENTICATED = 235;
const SEND_DATA = 354;
const CLOSING = 221;

export const sendMail = async (
  settings: SmtpSettings,
  message: SmtpMessage,
): Promise<void> => {
  const wire = await connect(settings);
  try {
    await wire.expect(GREETING);
    await wire.command("EHLO elliott", OKAY);
    await wire.command(
      `AUTH PLAIN ${plainCredentials(settings)}`,
      AUTHENTICATED,
    );
    await wire.command(`MAIL FROM:<${settings.from}>`, OKAY);
    await wire.command(`RCPT TO:<${message.to}>`, OKAY);
    await wire.command("DATA", SEND_DATA);
    await wire.command(mime(settings, message), OKAY);
    await wire.command("QUIT", CLOSING);
  } finally {
    wire.close();
  }
};

const plainCredentials = (settings: SmtpSettings): string =>
  Buffer.from(`\u{0}${settings.username}\u{0}${settings.password}`)
    .toString("base64");

const mime = (settings: SmtpSettings, message: SmtpMessage): string => {
  const subject = `=?UTF-8?B?${
    Buffer.from(message.subject).toString("base64")
  }?=`;
  const body = message.body
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  return [
    `From: ${settings.from}`,
    `To: ${message.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    ".",
  ].join("\r\n");
};

const connect = (settings: SmtpSettings): Promise<SmtpWire> => {
  const state: WireState = {
    buffer: "",
    lines: [],
    replies: [],
    waiters: [],
    failure: undefined,
  };
  return new Promise((resolve, reject) => {
    Bun.connect({
      hostname: settings.host,
      port: settings.port,
      tls: true,
      socket: {
        open: (socket) => resolve(makeWire(socket, state)),
        data: (_socket, chunk) => feed(state, chunk.toString()),
        error: (_socket, error) => fail(state, error),
        close: () => fail(state, new Error("SMTP connection closed")),
      },
    }).catch((error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
};

const makeWire = (socket: Socket, state: WireState): SmtpWire => ({
  command: (line, code) => {
    socket.write(`${line}\r\n`);
    return takeReply(state, code);
  },
  expect: (code) => takeReply(state, code),
  close: () => socket.end(),
});

const takeReply = (state: WireState, code: number): Promise<string> =>
  nextReply(state).then((reply) => {
    if (!reply.startsWith(String(code))) {
      throw new Error(`SMTP expected ${code}, got: ${reply}`);
    }
    return reply;
  });

const nextReply = (state: WireState): Promise<string> => {
  const queued = state.replies.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  if (state.failure !== undefined) return Promise.reject(state.failure);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = state.waiters.findIndex((item) => item.resolve === settle);
      if (index !== -1) state.waiters.splice(index, 1);
      reject(new Error("SMTP reply timed out"));
    }, REPLY_TIMEOUT_MILLISECONDS);
    const settle = (reply: string): void => {
      clearTimeout(timeout);
      resolve(reply);
    };
    state.waiters.push({
      resolve: settle,
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
};

const feed = (state: WireState, chunk: string): void => {
  state.buffer += chunk;
  for (;;) {
    const index = state.buffer.indexOf("\r\n");
    if (index === -1) return;
    const line = state.buffer.slice(0, index);
    state.buffer = state.buffer.slice(index + 2);
    state.lines.push(line);
    if (/^\d{3} /.test(line)) flushReply(state);
  }
};

const flushReply = (state: WireState): void => {
  const reply = state.lines.join("\n");
  state.lines = [];
  const waiter = state.waiters.shift();
  if (waiter === undefined) {
    state.replies.push(reply);
  } else {
    waiter.resolve(reply);
  }
};

const fail = (state: WireState, error: Error): void => {
  if (state.failure !== undefined) return;
  state.failure = error;
  const waiters = state.waiters;
  state.waiters = [];
  for (const waiter of waiters) waiter.reject(error);
};
