import type { ModelCatalogEntry } from "../model/types";

export interface HttpProviderConfig {
  readonly baseUrl: string;
  readonly catalog: readonly ModelCatalogEntry[];
  readonly fetcher?: typeof fetch;
}
