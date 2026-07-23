import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Channel, Outbound } from "../core/channels/types.js";
import { ChannelError } from "../core/errors.js";
import type { Health } from "../core/types.js";
import { chunkText } from "./chunk.js";
import { BlueBubblesResponseSchema } from "./schema.js";
import type { ImessageConfig } from "./types.js";

const IMESSAGE_LIMIT = 4000;
const HTTP_ERROR_FLOOR = 400;
// BlueBubbles serves plain HTTP on the LAN (host.docker.internal); it has no TLS.
// eslint-disable-next-line unicorn/prefer-https
const DEFAULT_SERVER_URL = "http://host.docker.internal:1234";
const GUID_SEP = ";-;";

const decodeBlueBubbles = Schema.decodeUnknownSync(
  Schema.fromJsonString(BlueBubblesResponseSchema),
);

// A handle (+15551234567 / email) becomes a `<service>;-;<handle>` chat GUID;
// a value already containing the separator is passed through unchanged.
const toChatGuid = (service: string, to: string): string =>
  to.includes(GUID_SEP) ? to : `${service}${GUID_SEP}${to}`;

// Unique per send — BlueBubbles' AppleScript method requires a fresh tempGuid.
const tempGuid = (): string => `agentkit-${crypto.randomUUID()}`;

/**
 * iMessage/SMS outbound adapter — the Effect/Channel port of the api-h12o
 * `imessage`/bluebubbles notify connector. Delivers through a BlueBubbles
 * server's REST API. Recipient comes from the conversationKey
 * (`imessage:<handle-or-guid>`) or `defaultRecipient`. Outbound-only: BlueBubbles
 * inbound (a `POST /message/query` read path / webhooks) is a separate adapter,
 * so `listen` is a no-op here.
 */
export class ImessageChannel implements Channel {
  readonly name = "imessage";
  private readonly serverUrl: string;
  private readonly method: "apple-script" | "private-api";
  private readonly service: "iMessage" | "SMS";

  constructor(
    private readonly cfg: ImessageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.serverUrl = cfg.serverUrl ?? DEFAULT_SERVER_URL;
    this.method = cfg.method ?? "apple-script";
    this.service = cfg.service ?? "iMessage";
  }

  async listen(): Promise<void> {}

  send(out: Outbound): Effect.Effect<void, ChannelError> {
    const recipient = out.conversationKey.replace(/^imessage:/, "")
      || this.cfg.defaultRecipient;
    return Effect.tryPromise({
      try: () => this.deliver(recipient, out.text),
      catch: (cause) =>
        cause instanceof ChannelError
          ? cause
          : new ChannelError({
            message: String(cause),
            kind: "delivery",
            cause,
          }),
    });
  }

  private async deliver(
    recipient: string | undefined,
    text: string,
  ): Promise<void> {
    if (!recipient) {
      throw new ChannelError({
        message:
          "imessage: no recipient (conversationKey imessage:<handle> or defaultRecipient)",
        kind: "delivery",
      });
    }
    const chatGuid = toChatGuid(this.service, recipient);
    const url = `${this.serverUrl}/api/v1/message/text?password=${
      encodeURIComponent(this.cfg.password)
    }`;
    for (const chunk of chunkText(text, IMESSAGE_LIMIT)) {
      await this.post(url, {
        chatGuid,
        tempGuid: tempGuid(),
        message: chunk,
        method: this.method,
      });
    }
  }

  private async post(url: string, payload: unknown): Promise<void> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new ChannelError({
        message: `imessage: http ${res.status}`,
        kind: "delivery",
      });
    }
    const body = decodeBlueBubbles(await res.text());
    // BlueBubbles returns HTTP 200 with a body `status` >= 400 on failure.
    if (typeof body.status === "number" && body.status >= HTTP_ERROR_FLOOR) {
      throw new ChannelError({
        message: `imessage: ${body.message ?? "send failed"}`,
        kind: "delivery",
      });
    }
  }

  async stop(): Promise<void> {}

  async health(): Promise<Health> {
    return this.cfg.password
      ? { state: "ok" }
      : { state: "down", detail: "no BlueBubbles password" };
  }
}
