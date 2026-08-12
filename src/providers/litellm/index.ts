import type {
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ModelCatalogEntry,
  ModelGenerateRequest,
  ModelProviderProtocol,
  ModelStreamEvent,
} from "../../model/types";
import { jsonRecord, nestedRecord, recordArray } from "../http";
import type { HttpProviderConfig } from "../types";

export class LiteLlmProvider implements ModelProviderProtocol {
  readonly #config: HttpProviderConfig;
  readonly #fetcher: typeof fetch;

  constructor(config: HttpProviderConfig) {
    this.#config = config;
    this.#fetcher = config.fetcher ?? fetch;
  }

  async catalog(): Promise<readonly ModelCatalogEntry[]> {
    return this.#config.catalog;
  }

  async *generate(
    request: ModelGenerateRequest,
  ): AsyncIterable<ModelStreamEvent> {
    const response = await this.#fetcher(
      new URL("/v1/chat/completions", this.#config.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          tools: request.tools,
          response_format: request.responseSchema,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          stream: false,
        }),
      },
    );
    if (!response.ok) {
      yield { type: "error", payload: { status: response.status } };
      return;
    }
    const payload = await jsonRecord(response);
    const choice = recordArray(payload, "choices")[0];
    const message = choice === undefined
      ? undefined
      : nestedRecord(choice, "message");
    const content = message?.content;
    if (typeof content === "string") yield { type: "text", payload: content };
    if (message !== undefined) {
      for (const call of recordArray(message, "tool_calls")) {
        yield { type: "tool-call", payload: call };
      }
    }
    yield { type: "usage", payload: payload.usage ?? {} };
    yield { type: "done", payload: {} };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.#fetcher(
      new URL("/v1/embeddings", this.#config.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: request.modelId, input: request.inputs }),
      },
    );
    if (!response.ok) {
      throw new Error(`LiteLLM embedding failed: ${response.status}`);
    }
    const payload = await jsonRecord(response);
    const embeddings = recordArray(payload, "data").map((item) =>
      Array.isArray(item.embedding)
        ? item.embedding.filter((value): value is number =>
          typeof value === "number"
        )
        : []
    );
    return { embeddings };
  }

  async health(): Promise<HealthStatus> {
    const response = await this.#fetcher(
      new URL("/health", this.#config.baseUrl),
    );
    return response.ok
      ? { healthy: true }
      : { healthy: false, detail: `HTTP ${response.status}` };
  }
}
