import type {
  LlmEffort,
  LlmEndpoint,
  LlmProvider,
  LlmThinking,
} from "../types";

// First-party provider defaults. `baseUrl` is the endpoint elliott talks to
// when the operator names a provider instead of a URL; `wire` is the protocol
// spoken there. Both are resolved at the config boundary, so nothing
// downstream carries a provider name — only a concrete URL and a wire.
const PROVIDER_DEFAULTS: Readonly<Record<LlmProvider, LlmEndpoint>> = Object
  .freeze({
    anthropic: Object.freeze({
      baseUrl: "https://api.anthropic.com/v1",
      wire: "anthropic",
    }),
    openai: Object.freeze({
      baseUrl: "https://api.openai.com/v1",
      wire: "openai",
    }),
  });

const PROVIDER_NAMES = Object.keys(PROVIDER_DEFAULTS)
  .sort((left, right) => left.localeCompare(right))
  .join(", ");

const isProvider = (value: string): value is LlmProvider =>
  Object.hasOwn(PROVIDER_DEFAULTS, value);

const THINKING_MODES: readonly LlmThinking[] = ["adaptive", "disabled"];

const EFFORT_LEVELS: readonly LlmEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const parseEnum = <T extends string>(
  configPath: string,
  allowed: readonly T[],
  value: string | undefined,
): T | undefined => {
  if (value === undefined) return undefined;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(
      `Invalid ${configPath}: ${value} (expected one of: ${
        allowed.join(", ")
      })`,
    );
  }
  return match;
};

// Reasoning controls are validated here rather than passed through blindly, so
// a typo fails at boot instead of on every turn as a provider-side 400.
export const parseThinking = (
  value: string | undefined,
): LlmThinking | undefined =>
  parseEnum("llm.profiles.default.thinking", THINKING_MODES, value);

export const parseEffort = (value: string | undefined): LlmEffort | undefined =>
  parseEnum("llm.profiles.default.effort", EFFORT_LEVELS, value);

// Resolution is deliberately explicit and fails closed. A bare api_key is not
// enough to name an endpoint: elliott never guesses a host from a key prefix
// or a model name, because a wrong guess ships prompts to a vendor the
// operator did not choose. Precedence:
//
//   1. `llm.provider` names the wire; `llm.base_url` overrides its host when
//      present (an Anthropic-speaking gateway on a private URL is valid).
//   2. `llm.base_url` alone means an OpenAI-compatible endpoint — the shape
//      every pre-provider config already used, so those keep booting.
//   3. Neither is a boot failure naming both ways to fix it.
export const resolveLlmEndpoint = (
  provider: string | undefined,
  baseUrl: string | undefined,
): LlmEndpoint => {
  if (provider !== undefined) {
    if (!isProvider(provider)) {
      throw new Error(
        `Unknown llm.provider: ${provider} (expected one of: ${PROVIDER_NAMES})`,
      );
    }
    const preset = PROVIDER_DEFAULTS[provider];
    return { baseUrl: baseUrl ?? preset.baseUrl, wire: preset.wire };
  }
  if (baseUrl !== undefined) return { baseUrl, wire: "openai" };
  throw new Error(
    "Missing configuration: set llm.base_url to an OpenAI-compatible "
      + `endpoint, or llm.provider to one of: ${PROVIDER_NAMES}`,
  );
};
