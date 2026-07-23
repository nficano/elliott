import { VersionedCache } from "../../core/cache/versioned";
import { hashValue } from "../../core/digest";
import type { EpochRegistry } from "../../core/epoch/epochs";
import { GrantRevokedError } from "../../core/errors";
import type { GrantHandle } from "../../core/types";
import type { ApprovalOutcome } from "../approvals/types";
import { explainGrant, resolveGrantSet } from "./resolution";
import type {
  GrantConsumption,
  GrantExplanation,
  GrantIssueInput,
  GrantPolicyState,
  GrantPolicyUpdate,
  GrantSet,
  ResolvedGrantEntry,
} from "./types";

const isResolvedEntry = (value: unknown): value is ResolvedGrantEntry => {
  if (typeof value !== "object" || value === null) return false;
  return "handle" in value && typeof value.handle === "string"
    && "grantSet" in value && typeof value.grantSet === "object"
    && "revoked" in value && typeof value.revoked === "boolean";
};

const stateFromInput = (input: GrantIssueInput): GrantPolicyState => ({
  ...input,
  activeDeferred: new Set(),
  revoked: false,
});

export class GrantManager {
  readonly #states = new Map<GrantHandle, GrantPolicyState>();
  readonly #consumption = new Map<GrantHandle, GrantConsumption>();
  readonly #epochs: EpochRegistry;
  readonly #cache = new VersionedCache<ResolvedGrantEntry>({
    is: isResolvedEntry,
    digest: hashValue,
  });

  constructor(epochs: EpochRegistry) {
    this.#epochs = epochs;
  }

  issue(input: GrantIssueInput): void {
    this.#states.set(input.handle, stateFromInput(input));
    this.#consumption.set(input.handle, {
      concurrency: 0,
      costUsd: 0,
      tokens: 0,
    });
  }

  async resolve(handle: GrantHandle): Promise<GrantSet> {
    const state = this.#required(handle);
    const vector = this.#epochs.vector(state.coordinates);
    const resolved = await this.#cache.resolve(
      handle,
      { epochs: vector, digests: state.policyDigests },
      async () => ({
        handle,
        grantSet: resolveGrantSet(state, state.activeDeferred),
        epochVector: vector,
        revoked: state.revoked,
      }),
    );
    if (resolved.value.revoked) {
      state.onDrain();
      throw new GrantRevokedError(handle);
    }
    return resolved.value.grantSet;
  }

  explain(handle: GrantHandle, capability: string): GrantExplanation {
    const state = this.#required(handle);
    return explainGrant(state, capability, state.activeDeferred);
  }

  async update(handle: GrantHandle, update: GrantPolicyUpdate): Promise<void> {
    const state = this.#required(handle);
    this.#states.set(handle, {
      ...state,
      sources: update.sources,
      limitSources: update.limitSources,
      policyDigests: update.policyDigests,
    });
    await this.#epochs.bump(
      update.changedScope,
      update.changedScopeId,
      "policy-change",
    );
  }

  async revoke(handle: GrantHandle): Promise<void> {
    const state = this.#required(handle);
    this.#states.set(handle, { ...state, revoked: true });
    await this.#epochs.bump("session", state.coordinates.session, "revocation");
  }

  async activateDeferred(
    handle: GrantHandle,
    capability: string,
    approval: ApprovalOutcome,
  ): Promise<void> {
    if (
      approval.request.purpose !== "deferred-grant"
      || (approval.decision !== "allow-once"
        && approval.decision !== "allow-session")
      || approval.request.requestedCapabilities.every((requested) =>
        requested.capability !== capability || requested.deferred !== true
      )
      || Date.parse(approval.request.expiresAt) <= Date.now()
    ) throw new Error("Deferred grant activation requires an approval");
    const state = this.#required(handle);
    const activeDeferred = new Set(state.activeDeferred);
    activeDeferred.add(capability);
    this.#states.set(handle, { ...state, activeDeferred });
    await this.#epochs.bump(
      "session",
      state.coordinates.session,
      "deferred-grant-activation",
    );
  }

  consume(handle: GrantHandle, delta: GrantConsumption): void {
    const state = this.#required(handle);
    const grant = resolveGrantSet(state, state.activeDeferred);
    const current = this.#consumption.get(handle) ?? {
      concurrency: 0,
      costUsd: 0,
      tokens: 0,
    };
    const next = {
      concurrency: current.concurrency + delta.concurrency,
      costUsd: current.costUsd + delta.costUsd,
      tokens: current.tokens + delta.tokens,
    };
    if (
      (grant.limits.maxConcurrency !== undefined
        && next.concurrency > grant.limits.maxConcurrency)
      || (grant.limits.maxCostUsd !== undefined
        && next.costUsd > grant.limits.maxCostUsd)
      || (grant.limits.maxTokens !== undefined
        && next.tokens > grant.limits.maxTokens)
    ) throw new Error("Live resource limit exceeded");
    this.#consumption.set(handle, next);
  }

  release(handle: GrantHandle): void {
    this.#states.delete(handle);
    this.#consumption.delete(handle);
  }

  #required(handle: GrantHandle): GrantPolicyState {
    const state = this.#states.get(handle);
    if (state === undefined) throw new Error(`Unknown GrantHandle ${handle}`);
    return state;
  }
}
