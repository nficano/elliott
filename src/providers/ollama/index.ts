import type {
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ModelCatalogEntry,
  ModelGenerateRequest,
  ModelProviderProtocol,
  ModelStreamEvent,
} from "../../model/types";
import { jsonRecord, nestedRecord, numberVectors, recordArray } from "../http";
import type { HttpProviderConfig } from "../types";

export class OllamaProvider implements ModelProviderProtocol {
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
      new URL("/api/chat", this.#config.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          tools: request.tools,
          format: request.responseSchema,
          stream: false,
          options: {
            temperature: request.temperature,
            num_predict: request.maxOutputTokens,
          },
        }),
      },
    );
    if (!response.ok) {
      yield { type: "error", payload: { status: response.status } };
      return;
    }
    const payload = await jsonRecord(response);
    const message = nestedRecord(payload, "message");
    const content = message?.content;
    if (typeof content === "string") yield { type: "text", payload: content };
    if (message !== undefined) {
      for (const call of recordArray(message, "tool_calls")) {
        yield { type: "tool-call", payload: call };
      }
    }
    yield { type: "usage", payload };
    yield { type: "done", payload: {} };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.#fetcher(
      new URL("/api/embed", this.#config.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: request.modelId, input: request.inputs }),
      },
    );
    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }
    const payload = await jsonRecord(response);
    return { embeddings: numberVectors(payload.embeddings) };
  }

  async health(): Promise<HealthStatus> {
    const response = await this.#fetcher(
      new URL("/api/tags", this.#config.baseUrl),
    );
    return response.ok
      ? { healthy: true }
      : { healthy: false, detail: `HTTP ${response.status}` };
  }
}
