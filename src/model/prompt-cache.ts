import { hashValue } from "../core/digest";
import type { PromptAssembly } from "../prompt/types";
import { residencySatisfies } from "../security/residency/residency";
import type { PromptCachePlan } from "./cache/types";
import type { ResolvedModelRoute } from "./routing/types";

export const planPromptCache = (
  prompt: PromptAssembly,
  route: ResolvedModelRoute,
): PromptCachePlan => {
  const supportsCaching = route.catalog.capabilities.includes("prompt-caching");
  const directives = prompt.segments.map((segment, index) => {
    const residencyAllowed = residencySatisfies(
      route.residency,
      segment.classification,
    );
    const stable = index < prompt.cacheBreakpoint;
    const cache = stable && supportsCaching && residencyAllowed;
    return Object.freeze({
      segment,
      classification: segment.classification,
      cache,
      noStore: !cache,
    });
  });
  return Object.freeze({
    identity: hashValue({
      prefix: prompt.stablePrefix.map((segment) => segment.digest),
      profileRoute: `${route.provider}/${route.model}`,
    }),
    directives: Object.freeze(directives),
  });
};

export class LocalPrefixCache {
  readonly #entries = new Map<string, string>();

  put(plan: PromptCachePlan, route: ResolvedModelRoute, value: string): void {
    if (route.residency.egress !== "none") {
      throw new Error("Kernel prefix cache is local-route only");
    }
    this.#entries.set(plan.identity, value);
  }

  get(plan: PromptCachePlan): string | undefined {
    return this.#entries.get(plan.identity);
  }
}

export type * from "./cache/types";
