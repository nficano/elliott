import type { BlueBubblesSettings } from "../../../src/runtime/types";

export type BlueBubblesJson = Readonly<Record<string, unknown>>;

export interface BlueBubblesTransport {
  readonly settings: BlueBubblesSettings;
  readonly fetcher: typeof fetch;
}

export interface BlueBubblesRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: BlueBubblesJson;
  readonly query?: Readonly<Record<string, string>>;
}

export interface ResolvedChat {
  readonly guid: string;
  readonly name: string;
}

export interface ConversationRead {
  readonly name: string;
  readonly messages: readonly BlueBubblesJson[];
}

export interface BlueBubblesClient {
  queryRecent(limit: number): Promise<readonly BlueBubblesJson[]>;
  readFrom(
    target: string,
    limit: number,
  ): Promise<ConversationRead | undefined>;
  // Deliver a text to a recipient (handle or full chat GUID), chunked to the
  // iMessage-safe size. Recipient policy is the caller's responsibility.
  sendText(recipient: string, text: string): Promise<void>;
}
