import { ConfigError } from "../../core/errors.js";
import type { ModelChoice } from "../../core/types.js";
import type { ResolvedProfile, ResolveModelOptions } from "./types.js";

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.4;

export type { ResolveModelOptions } from "./types.js";

/**
 * Model routing (§9). Code names a *tier*; config maps tier→model. A *profile*
 * rides orthogonally (task shape). Swapping a model is a one-line YAML edit.
 *
 * - Explicit pin (user/skill `preferredModel`) resolves EXACTLY or fails loudly —
 *   no silent downgrade (§9 strict-for-explicit).
 * - Configured defaults use the tier→model table.
 * - `modelPolicy.allow` wildcard allowlist is a §16 guardrail on what may be
 *   routed to (an injected pin can't reach an arbitrary model).
 */
export function resolveModel(options: ResolveModelOptions): ModelChoice {
  const { cfg, tier } = options;
  const row = cfg.llm.models[tier];
  if (!row) {
    throw new ConfigError({
      message: `no model configured for tier '${tier}'`,
    });
  }
  const { pin, maxTokens, temperature } = resolveProfile(options);
  const model = pin ?? row.model;
  assertAllowed(model, cfg.llm.allow);
  return {
    model,
    tier,
    maxTokens,
    temperature,
    allowFallback: pin === undefined,
  };
}

function resolveProfile(options: ResolveModelOptions): ResolvedProfile {
  const { cfg, profileName, profileOverride } = options;
  const profile = profileName ? cfg.llm.profiles[profileName] : undefined;
  return {
    pin: profileOverride?.preferredModel ?? profile?.preferred_model,
    maxTokens: firstDefined(
      [profileOverride?.maxTokens, profile?.max_tokens],
      DEFAULT_MAX_TOKENS,
    ),
    temperature: firstDefined(
      [profileOverride?.temperature, profile?.temperature],
      DEFAULT_TEMPERATURE,
    ),
  };
}

function assertAllowed(model: string, allow: readonly string[]): void {
  if (!isAllowed(model, allow)) {
    throw new ConfigError({
      message: `model '${model}' is not in llm.allow (§9 guardrail)`,
    });
  }
}

function firstDefined<T>(
  values: readonly (T | undefined)[],
  fallback: T,
): T {
  return values.find((value): value is T => value !== undefined) ?? fallback;
}

function isAllowed(model: string, allow: readonly string[]): boolean {
  return allow.some((pat) => {
    if (pat === "*") return true;
    if (pat.endsWith("/*")) return model.startsWith(pat.slice(0, -1));
    return model === pat;
  });
}
