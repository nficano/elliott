import { newId } from "../../core/digest";
import type { PlacementRef } from "../../core/types";
import { intersectEgress } from "../egress";
import type {
  CompanionCanary,
  CompanionInstance,
  CompanionOpenRequest,
} from "../types";

const isDigestPinned = (image: string): boolean => image.includes("@sha256:");

export class CompanionManager {
  readonly #companions = new Map<string, CompanionInstance>();
  readonly #canary: CompanionCanary;

  constructor(canary: CompanionCanary) {
    this.#canary = canary;
  }

  async open(request: CompanionOpenRequest): Promise<CompanionInstance> {
    const { owner, context, ownerEgress, declaration } = request;
    if (!isDigestPinned(declaration.image)) {
      throw new Error("Companion images must be digest-pinned");
    }
    const effectiveEgress = intersectEgress(ownerEgress, declaration.egress);
    const companion: CompanionInstance = Object.freeze({
      id: newId("companion"),
      owner,
      declaration,
      securityContext: context,
      effectiveEgress,
      reachableBy: Object.freeze([owner]),
      state: "open",
    });
    if (
      effectiveEgress.kind === "none" && await this.#canary.probe(companion)
    ) {
      throw new Error("None-egress companion passed the external canary");
    }
    this.#companions.set(companion.id, companion);
    return companion;
  }

  list(owner?: PlacementRef): readonly CompanionInstance[] {
    const companions = [...this.#companions.values()];
    return owner === undefined
      ? companions
      : companions.filter((companion) => companion.owner === owner);
  }

  canReach(id: string, caller: PlacementRef): boolean {
    return this.#companions.get(id)?.reachableBy.includes(caller) ?? false;
  }

  drainOwner(owner: PlacementRef): readonly CompanionInstance[] {
    const closed: CompanionInstance[] = [];
    for (const companion of this.list(owner)) {
      const next: CompanionInstance = Object.freeze({
        ...companion,
        state: "closed",
      });
      this.#companions.set(companion.id, next);
      closed.push(next);
    }
    return closed;
  }

  reapOrphans(liveOwners: ReadonlySet<PlacementRef>): readonly string[] {
    const reaped: string[] = [];
    const companions = this.list();
    for (const companion of companions) {
      if (liveOwners.has(companion.owner) || companion.state === "closed") {
        continue;
      }
      const closed: CompanionInstance = Object.freeze({
        ...companion,
        state: "closed",
      });
      this.#companions.set(companion.id, closed);
      reaped.push(companion.id);
    }
    return reaped;
  }
}
