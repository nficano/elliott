export interface BenchmarkClientConfig {
  readonly endpoint: string;
  readonly fetch: typeof globalThis.fetch;
}
