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

export interface BlueBubblesClient {
  queryRecent(limit: number): Promise<readonly BlueBubblesJson[]>;
  queryChat(guid: string, limit: number): Promise<readonly BlueBubblesJson[]>;
  resolveChat(target: string): Promise<ResolvedChat | undefined>;
}
