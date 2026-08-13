import { expect, test } from "bun:test";
import type { SlackSettings } from "../../../src/runtime/types";
import { SlackGateway } from "../src/gateway";
import type { SlackJson, SlackSocketHandlers } from "../src/types";

// The 2026-07-29 outage: the app's event subscriptions were edited away and
// the agent went deaf for days while /healthz reported the socket
// "connected". status() must expose event recency so silence is visible.

const MILLISECONDS_PER_MINUTE = 60_000;
const ELAPSED_MINUTES = 7;

const settings: SlackSettings = {
  appToken: "xapp-test",
  botToken: "xoxb-test",
  ownerId: "UOWNER",
  defaultChannel: "#general",
};

const client = (responses: Readonly<Record<string, SlackJson>>) => ({
  request: (method: string) =>
    Promise.resolve(responses[method] ?? { ok: true }),
});

const makeGateway = (now: () => number) => {
  let handlers: SlackSocketHandlers | undefined;
  const gateway = new SlackGateway(settings, {
    clients: {
      app: client({
        "apps.connections.open": { ok: true, url: "wss://socket.test" },
      }),
      bot: client({ "auth.test": { ok: true, user_id: "UBOT" } }),
    },
    report: () => {},
    openSocket: (_url, socketHandlers) => {
      handlers = socketHandlers;
      return Promise.resolve({
        send: () => {},
        close: () => socketHandlers.onClose(),
      });
    },
    now,
  });
  return { gateway, handlers: () => handlers };
};

const waitForConnection = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

test("status distinguishes a connected-but-silent socket", async () => {
  let currentTime = 0;
  const { gateway, handlers } = makeGateway(() => currentTime);
  expect(gateway.status()).toBe("connecting (no events since boot)");

  await gateway.start({
    onMessage: () => Promise.resolve(),
    onFeedback: () => Promise.resolve(),
    onError: () => {},
  });
  await waitForConnection();
  expect(gateway.status()).toBe("connected (no events since boot)");

  handlers()?.onMessage(JSON.stringify({
    type: "events_api",
    envelope_id: "envelope-1",
    payload: { event: { type: "app_context_changed", context: {} } },
  }));
  expect(gateway.status()).toBe("connected (last event 0m ago)");

  currentTime += ELAPSED_MINUTES * MILLISECONDS_PER_MINUTE;
  expect(gateway.status()).toBe(
    `connected (last event ${ELAPSED_MINUTES}m ago)`,
  );

  gateway.stop();
});

test("non-event frames do not count as delivery", async () => {
  const currentTime = 0;
  const { gateway, handlers } = makeGateway(() => currentTime);
  await gateway.start({
    onMessage: () => Promise.resolve(),
    onFeedback: () => Promise.resolve(),
    onError: () => {},
  });
  await waitForConnection();

  handlers()?.onMessage(JSON.stringify({ type: "hello" }));
  expect(gateway.status()).toBe("connected (no events since boot)");

  gateway.stop();
});
