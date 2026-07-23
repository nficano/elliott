import type { ExternalMemoryProvider } from "../types";

export class ExternalMemorySlot {
  #provider: ExternalMemoryProvider | undefined;

  register(provider: ExternalMemoryProvider): void {
    if (this.#provider !== undefined) {
      throw new Error("Only one external memory provider may be active");
    }
    if (
      provider.companion !== undefined
      && provider.companion.egress.kind !== "none"
    ) {
      throw new Error(
        "External memory database companions must use none egress",
      );
    }
    this.#provider = provider;
  }

  get active(): ExternalMemoryProvider | undefined {
    return this.#provider;
  }

  initialize(): Promise<void> {
    return this.#required().initialize();
  }

  systemPromptBlock(): Promise<string> {
    return this.#required().systemPromptBlock();
  }

  prefetch(query: string) {
    return this.#required().prefetch(query);
  }

  syncTurn(sessionId: string): Promise<void> {
    return this.#required().syncTurn(sessionId);
  }

  onPreCompress(sessionId: string): Promise<void> {
    return this.#required().onPreCompress(sessionId);
  }

  onSessionEnd(sessionId: string): Promise<void> {
    return this.#required().onSessionEnd(sessionId);
  }

  toolSchemas(): readonly Readonly<Record<string, unknown>>[] {
    return this.#required().toolSchemas();
  }

  clear(): void {
    this.#provider = undefined;
  }

  #required(): ExternalMemoryProvider {
    if (this.#provider === undefined) {
      throw new Error("No external memory provider is active");
    }
    return this.#provider;
  }
}
