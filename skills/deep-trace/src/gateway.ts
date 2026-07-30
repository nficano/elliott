import type {
  GatewayBinding,
  GatewayEvents,
  GatewayResponse,
} from "../../../src/runtime/skills/types";
import type { InboundMessage } from "../../../src/runtime/types";

// A minimal gateway that captures agent responses for the /send route.
// It registers under the name "deep-trace" so #replyGateway in app.ts
// routes replies here instead of to Slack; `send` is a no-op because
// beginResponse intercepts before the fallback send path is reached.
export class DeepTraceGateway implements GatewayBinding {
  readonly name = "deep-trace";
  readonly #pending = new Map<string, (answer: string) => void>();

  status(): string {
    return "active";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async start(events: GatewayEvents): Promise<void> {}

  stop(): void {}

  // No-op send keeps #replyGateway from falling back to the primary gateway.
  // Responses flow exclusively through beginResponse / captureResponse.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async send(channel: string, text: string): Promise<void> {}

  // Called by the POST route before injecting the message.  Returns a Promise
  // that resolves once the agent calls response.complete / response.fail.
  captureResponse(channel: string, fire: () => void): Promise<string> {
    return new Promise<string>((resolve) => {
      this.#pending.set(channel, resolve);
      fire();
    });
  }

  async beginResponse(message: InboundMessage): Promise<GatewayResponse> {
    const resolve = this.#pending.get(message.channel);
    const finish = (text: string): void => {
      if (resolve === undefined) return;
      this.#pending.delete(message.channel);
      resolve(text);
    };
    return {
      complete: async (text) => finish(text),
      fail: async (msg) => finish(msg),
    };
  }
}
