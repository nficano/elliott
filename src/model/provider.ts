import { scopeId } from "../core/brands";
import { hashValue } from "../core/digest";
import type { RecordAppender } from "../core/waist/types";
import {
  assertCatalogResidencyConsistent,
} from "../security/residency/residency";
import type {
  CachedProviderHealth,
  ProviderRegistrationInput,
  ProviderState,
} from "./provider/types";
import type { HealthStatus, ModelCatalogEntry } from "./types";

const healthValue = (
  status: HealthStatus,
  reportedAtMs: number,
  cadenceMs: number,
): CachedProviderHealth => {
  const common = { healthy: status.healthy, reportedAtMs, cadenceMs };
  return status.detail === undefined
    ? Object.freeze(common)
    : Object.freeze({ ...common, detail: status.detail });
};

export class ProviderStateRegistry {
  readonly #providers = new Map<string, ProviderState>();
  readonly #records: RecordAppender;
  readonly #onCatalogChanged: (provider: string) => Promise<void>;
  readonly #onHealthChanged: (provider: string) => Promise<void>;

  constructor(
    records: RecordAppender,
    onCatalogChanged: (provider: string) => Promise<void>,
    onHealthChanged: (provider: string) => Promise<void>,
  ) {
    this.#records = records;
    this.#onCatalogChanged = onCatalogChanged;
    this.#onHealthChanged = onHealthChanged;
  }

  register(input: ProviderRegistrationInput): ProviderState {
    assertCatalogResidencyConsistent(input.catalog, input.residency);
    const state = Object.freeze({
      id: input.id,
      protocol: input.protocol,
      residency: input.residency,
      catalog: Object.freeze([...input.catalog]),
      catalogDigest: hashValue(input.catalog),
      health: healthValue(input.health, input.reportedAtMs, input.cadenceMs),
    });
    this.#providers.set(input.id, state);
    return state;
  }

  get(id: string): ProviderState | undefined {
    return this.#providers.get(id);
  }

  list(): readonly ProviderState[] {
    return [...this.#providers.values()];
  }

  async reportHealth(
    id: string,
    status: HealthStatus,
    reportedAtMs: number,
  ): Promise<void> {
    const state = this.#required(id);
    const changed = state.health.healthy !== status.healthy;
    this.#providers.set(
      id,
      Object.freeze({
        ...state,
        health: healthValue(status, reportedAtMs, state.health.cadenceMs),
      }),
    );
    if (!changed) return;
    await this.#records.append({
      type: "provider.health",
      scope: { level: "organization", id: scopeId(id) },
      durability: "observational",
      classification: "internal",
      payload: { provider: id, healthy: status.healthy },
    });
    await this.#onHealthChanged(id);
  }

  async updateCatalog(
    id: string,
    catalog: readonly ModelCatalogEntry[],
  ): Promise<void> {
    const state = this.#required(id);
    const catalogDigest = hashValue(catalog);
    if (catalogDigest === state.catalogDigest) return;
    assertCatalogResidencyConsistent(catalog, state.residency);
    await this.#records.append({
      type: "provider.catalog",
      scope: { level: "organization", id: scopeId(id) },
      durability: "effect-gating",
      classification: "internal",
      payload: { provider: id, catalogDigest },
    });
    this.#providers.set(
      id,
      Object.freeze({
        ...state,
        catalog: Object.freeze([...catalog]),
        catalogDigest,
      }),
    );
    await this.#onCatalogChanged(id);
  }

  async markLapsed(nowMs: number): Promise<void> {
    for (const state of this.#providers.values()) {
      const lapsed = nowMs - state.health.reportedAtMs > state.health.cadenceMs;
      if (lapsed && state.health.healthy) {
        await this.reportHealth(
          state.id,
          { healthy: false, detail: "health reporting lapsed" },
          nowMs,
        );
      }
    }
  }

  async poll(id: string, nowMs: number): Promise<void> {
    const state = this.#required(id);
    const status = await state.protocol.health();
    await this.reportHealth(id, status, nowMs);
  }

  #required(id: string): ProviderState {
    const state = this.#providers.get(id);
    if (state === undefined) throw new Error(`Unknown model provider ${id}`);
    return state;
  }
}

export type * from "./provider/types";
