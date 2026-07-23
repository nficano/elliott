import type {
  ActivationHooks,
  ActivationResult,
  ConfigurationRevision,
} from "./types";

export class ConfigurationActivationManager {
  readonly #hooks: ActivationHooks;
  #active: ConfigurationRevision;

  constructor(active: ConfigurationRevision, hooks: ActivationHooks) {
    this.#active = active;
    this.#hooks = hooks;
  }

  get active(): ConfigurationRevision {
    return this.#active;
  }

  async activate(candidate: ConfigurationRevision): Promise<ActivationResult> {
    if (candidate.parentDigest !== this.#active.digest) {
      return Object.freeze({ type: "stale", active: this.#active });
    }
    const delta = await this.#hooks.evaluateSecurityDelta(
      this.#active,
      candidate,
    );
    await this.#hooks.startCandidate(candidate);
    const healthy = await this.#hooks.healthCheck(candidate);
    if (!healthy) {
      await this.#hooks.discard(candidate);
      return Object.freeze({ type: "rejected", active: this.#active, delta });
    }
    await this.#hooks.commit(Object.freeze({
      revision: candidate,
      touchedEpochs: candidate.touchedEpochs,
      policyDigests: candidate.policyDigests,
    }));
    this.#active = candidate;
    return Object.freeze({ type: "activated", active: candidate, delta });
  }
}

export type * from "./types";
