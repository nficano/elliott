export type BlueBubblesJson = Readonly<Record<string, unknown>>;

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
}
