// Catalog currency — TDD §7.6b. Push-based: catalogDigest changes re-run
// verification (including the G2 locality cross-check) and rebuild affected
// route tables. Silence marks a provider unhealthy — fail-closed.

export { ProviderStateRegistry } from "./provider";
export type {
  CachedProviderHealth,
  ProviderRegistrationInput,
  ProviderState,
} from "./provider/types";
