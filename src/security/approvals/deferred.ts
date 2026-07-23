import type { ApprovalRequest } from "./types";

const operationKey = (request: ApprovalRequest): string =>
  `${request.target}:${request.protocol}:${request.operation}`;

const deferredKey = (request: ApprovalRequest): string => {
  const scope = request.deferredScope;
  if (scope === undefined) {
    throw new Error("Deferred approval request requires posture scope");
  }
  switch (scope.posture) {
    case "standard": {
      return `workspace:${scope.workspace}:${operationKey(request)}`;
    }
    case "hardened": {
      return `session:${request.session}:${operationKey(request)}`;
    }
    case "regulated": {
      return `class:${scope.workspace}:${scope.invocationClass}:${
        operationKey(request)
      }`;
    }
  }
};

export class DeferredGrantApprovalMemory {
  readonly #approved = new Set<string>();
  readonly #queue = new Map<string, ApprovalRequest>();

  queue(request: ApprovalRequest): void {
    if (request.purpose !== "deferred-grant") return;
    const key = deferredKey(request);
    if (
      request.deferredScope?.posture === "regulated"
      && !this.#approved.has(key)
    ) this.#queue.set(request.id, request);
  }

  remember(request: ApprovalRequest): void {
    if (request.purpose !== "deferred-grant") return;
    this.#approved.add(deferredKey(request));
    this.#queue.delete(request.id);
  }

  approved(request: ApprovalRequest): boolean {
    return request.purpose === "deferred-grant"
      && this.#approved.has(deferredKey(request));
  }

  queued(): readonly ApprovalRequest[] {
    return Object.freeze([...this.#queue.values()]);
  }

  closeSession(session: string): void {
    for (const key of this.#approved) {
      if (key.startsWith(`session:${session}:`)) this.#approved.delete(key);
    }
  }
}
