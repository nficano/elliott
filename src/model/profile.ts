import type { RecordAppender } from "../core/waist/types";
import type {
  EscalationRequest,
  EscalationResult,
  ModelProfileConfiguration,
  ModelUsePolicy,
} from "./profile/types";
import type { ModelProfileId, ReservedProfile } from "./types";

const RESERVED: readonly ReservedProfile[] = ["fast", "balanced", "deep"];

const rank = (profile: ReservedProfile): number => RESERVED.indexOf(profile);

export const isReservedProfile = (
  value: string,
): value is ReservedProfile =>
  value === "fast" || value === "balanced" || value === "deep";

const isCustomProfile = (value: string): value is `custom:${string}` =>
  value.startsWith("custom:");

export const validateProfileId = (value: string): ModelProfileId => {
  if (isReservedProfile(value) || isCustomProfile(value)) return value;
  throw new Error(`Custom model profile must use custom: namespace: ${value}`);
};

export const validateProfileCompleteness = (
  configuration: ModelProfileConfiguration,
): void => {
  for (const profile of RESERVED) {
    const binding = configuration.profiles[profile];
    if (
      binding === undefined
      || (binding.routes.length === 0 && binding.unavailable !== true)
    ) {
      throw new Error(
        `Reserved profile ${profile} is not bound or unavailable`,
      );
    }
  }
};

export const profileWithinCeiling = (
  requested: ReservedProfile,
  maximum: ReservedProfile,
): boolean => rank(requested) <= rank(maximum);

export const narrowProfileCeiling = (
  parent: ReservedProfile,
  child: ReservedProfile,
): ReservedProfile => rank(parent) <= rank(child) ? parent : child;

// Decide an escalation from policy alone: reject when the target is not on the
// configured chain, exceeds the ceiling, or is `deep` without a grant. Pure;
// the caller records the decision only when it escalates.
export const evaluateEscalation = (
  policy: ModelUsePolicy,
  request: EscalationRequest,
): EscalationResult => {
  const chain = policy.escalationChains[request.from] ?? [];
  if (!chain.includes(request.to)) {
    return {
      profile: request.from,
      escalated: false,
      reason: "not-configured",
    };
  }
  if (!profileWithinCeiling(request.to, request.ceiling)) {
    return { profile: request.from, escalated: false, reason: "ceiling" };
  }
  if (request.to === "deep" && !request.hasDeepGrant) {
    return { profile: request.from, escalated: false, reason: "grant" };
  }
  return { profile: request.to, escalated: true };
};

export class ModelUsePolicyEngine {
  readonly #policy: ModelUsePolicy;
  readonly #records: RecordAppender;

  constructor(policy: ModelUsePolicy, records: RecordAppender) {
    this.#policy = policy;
    this.#records = records;
  }

  activityProfile(activity: string): ReservedProfile {
    return this.#policy.uses[activity] ?? this.#policy.defaultProfile;
  }

  async escalate(request: EscalationRequest): Promise<EscalationResult> {
    const result = evaluateEscalation(this.#policy, request);
    if (result.escalated) {
      await this.#records.append({
        type: "model.escalation",
        scope: request.scope,
        durability: "effect-gating",
        classification: "internal",
        payload: {
          activity: request.activity,
          from: request.from,
          to: request.to,
        },
      });
    }
    return result;
  }
}

export type * from "./profile/types";
