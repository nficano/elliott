import { placementRef } from "../../core/brands";
import { newId } from "../../core/digest";
import type { IsolationLevel } from "../../core/types";
import type { RecordAppender } from "../../core/waist/types";
import { compileCgroupSettings } from "../cgroups/index";
import { assertIsolation } from "../isolation";
import type {
  CgroupSettings,
  PlacementDecision,
  PlacementRequest,
  Sandbox,
  SecurityContext,
} from "../types";

const minimum = (
  left: number | undefined,
  right: number | undefined,
): number | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
};

const narrowCgroups = (
  left: CgroupSettings,
  right: CgroupSettings,
): CgroupSettings => {
  const entries = {
    cpuMax: minimum(left.cpuMax, right.cpuMax),
    memoryMaxBytes: minimum(left.memoryMaxBytes, right.memoryMaxBytes),
    pidsMax: minimum(left.pidsMax, right.pidsMax),
    ioMaxBytesPerSecond: minimum(
      left.ioMaxBytesPerSecond,
      right.ioMaxBytesPerSecond,
    ),
  };
  return Object.fromEntries(
    Object.entries(entries).filter((entry) => entry[1] !== undefined),
  );
};

const sameContext = (left: SecurityContext, right: SecurityContext): boolean =>
  left.effectiveCeilingDigest === right.effectiveCeilingDigest
  && left.maximumClassification === right.maximumClassification
  && left.trustDomain === right.trustDomain
  && left.scope.level === right.scope.level
  && left.scope.id === right.scope.id
  && left.securityCritical === right.securityCritical;

export class PlacementManager {
  readonly #idle = new Map<IsolationLevel, Sandbox[]>();
  readonly #pending = new Map<string, PlacementRequest>();
  readonly #active = new Map<string, PlacementDecision>();
  readonly #records: RecordAppender;

  constructor(records: RecordAppender) {
    this.#records = records;
  }

  addWarmSandbox(isolation: IsolationLevel): void {
    const sandboxes = this.#idle.get(isolation) ?? [];
    sandboxes.push({
      id: placementRef(newId("sandbox")),
      isolation,
      coldSpawned: false,
      occupants: [],
    });
    this.#idle.set(isolation, sandboxes);
  }

  registerCold(instanceId: string, request: PlacementRequest): void {
    assertIsolation(request);
    this.#pending.set(instanceId, request);
  }

  async activate(instanceId: string): Promise<PlacementDecision> {
    const existing = this.#active.get(instanceId);
    if (existing !== undefined) return existing;
    const request = this.#pending.get(instanceId);
    if (request === undefined) {
      throw new Error(`Unknown cold instance ${instanceId}`);
    }
    const sandbox = this.#allocate(request.requestedIsolation, instanceId);
    const cgroups = compileCgroupSettings({ limits: request.limits });
    const usedSnapshot =
      request.snapshotManifestDigest === request.manifest.digest
      && request.snapshotConfigDigest === request.configDigest;
    const decision: PlacementDecision = Object.freeze({
      ref: sandbox.id,
      sandbox,
      context: request.securityContext,
      cgroups,
      usedSnapshot,
      state: "open",
    });
    await this.#records.append({
      type: "placement.bound",
      scope: request.securityContext.scope,
      durability: "effect-gating",
      classification: "internal",
      payload: {
        instance: instanceId,
        sandbox: sandbox.id,
        isolation: sandbox.isolation,
        coldSpawned: sandbox.coldSpawned,
        cgroups,
        usedSnapshot,
      },
    });
    this.#active.set(instanceId, decision);
    this.#pending.delete(instanceId);
    return decision;
  }

  canCohabit(left: SecurityContext, right: SecurityContext): boolean {
    return !left.securityCritical
      && !right.securityCritical
      && sameContext(left, right);
  }

  async cohabit(
    instanceId: string,
    hostInstanceId: string,
  ): Promise<PlacementDecision> {
    const request = this.#pending.get(instanceId);
    const host = this.#active.get(hostInstanceId);
    if (request === undefined || host === undefined) {
      throw new Error(
        "Cohabitation requires a pending instance and active host",
      );
    }
    assertIsolation(request);
    if (
      request.requestedIsolation !== host.sandbox.isolation
      || !this.canCohabit(request.securityContext, host.context)
    ) throw new Error("Security contexts cannot cohabit");
    const sandbox = Object.freeze({
      ...host.sandbox,
      occupants: Object.freeze([...host.sandbox.occupants, instanceId]),
    });
    const cgroups = narrowCgroups(
      host.cgroups,
      compileCgroupSettings({ limits: request.limits }),
    );
    this.#replaceSandbox(host.sandbox.id, sandbox, cgroups);
    const decision: PlacementDecision = Object.freeze({
      ref: sandbox.id,
      sandbox,
      context: request.securityContext,
      cgroups,
      usedSnapshot: false,
      state: "open",
    });
    await this.#records.append({
      type: "placement.cohabited",
      scope: request.securityContext.scope,
      durability: "effect-gating",
      classification: "internal",
      payload: {
        instance: instanceId,
        host: hostInstanceId,
        sandbox: sandbox.id,
        cgroups,
      },
    });
    this.#active.set(instanceId, decision);
    this.#pending.delete(instanceId);
    return decision;
  }

  async ensureCurrent(
    instanceId: string,
    context: SecurityContext,
  ): Promise<PlacementDecision> {
    const current = this.#active.get(instanceId);
    if (current === undefined) return this.activate(instanceId);
    if (sameContext(current.context, context)) return current;
    const request = this.#pending.get(instanceId);
    const isolation = current.sandbox.isolation;
    this.#detach(instanceId, current.sandbox);
    const sandbox = this.#allocate(isolation, instanceId);
    const decision: PlacementDecision = Object.freeze({
      ref: sandbox.id,
      sandbox,
      context,
      cgroups: current.cgroups,
      usedSnapshot: false,
      state: "open",
    });
    await this.#records.append({
      type: "placement.relocated",
      scope: context.scope,
      durability: "effect-gating",
      classification: "internal",
      payload: {
        instance: instanceId,
        from: current.sandbox.id,
        to: sandbox.id,
        reason: "security-context-diverged",
        pendingRequestKnown: request !== undefined,
        cgroups: current.cgroups,
      },
    });
    this.#active.set(instanceId, decision);
    return decision;
  }

  #detach(instanceId: string, sandbox: Sandbox): void {
    const occupants = sandbox.occupants.filter((occupant) =>
      occupant !== instanceId
    );
    const detached = Object.freeze({
      ...sandbox,
      occupants: Object.freeze(occupants),
    });
    this.#replaceSandbox(sandbox.id, detached);
  }

  #replaceSandbox(
    id: Sandbox["id"],
    sandbox: Sandbox,
    cgroups?: CgroupSettings,
  ): void {
    for (const [instanceId, decision] of this.#active) {
      if (decision.sandbox.id !== id) continue;
      this.#active.set(
        instanceId,
        Object.freeze({
          ...decision,
          sandbox,
          cgroups: cgroups ?? decision.cgroups,
        }),
      );
    }
  }

  #allocate(isolation: IsolationLevel, occupant: string): Sandbox {
    const sandboxes = this.#idle.get(isolation) ?? [];
    const warm = sandboxes.pop();
    this.#idle.set(isolation, sandboxes);
    if (warm !== undefined) {
      return Object.freeze({ ...warm, occupants: Object.freeze([occupant]) });
    }
    return Object.freeze({
      id: placementRef(newId("sandbox")),
      isolation,
      coldSpawned: true,
      occupants: Object.freeze([occupant]),
    });
  }
}
