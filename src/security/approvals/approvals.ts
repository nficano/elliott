import { hashBytes } from "../../core/digest";
import type { RecordAppender } from "../../core/waist/types";
import { DeferredGrantApprovalMemory } from "./deferred";
import type {
  ApprovalDecisionInput,
  ApprovalOutcome,
  ApprovalRequest,
} from "./types";

export const validatePresentation = (
  request: ApprovalRequest,
  input: ApprovalDecisionInput,
  decidedAt: string,
): void => {
  if (
    input.presentedCanonicalInput !== request.canonicalInput
    || hashBytes(input.presentedCanonicalInput) !== request.inputDigest
  ) throw new Error("Operator presentation differs from approved bytes");
  if (Date.parse(decidedAt) > Date.parse(request.expiresAt)) {
    throw new Error("Approval request expired");
  }
};

export class ApprovalService {
  readonly #requests = new Map<string, ApprovalRequest>();
  readonly #outcomes = new Map<string, ApprovalOutcome>();
  readonly #sessionAllowances = new Set<string>();
  readonly #deferred = new DeferredGrantApprovalMemory();
  readonly #records: RecordAppender;
  readonly #createProposal: (request: ApprovalRequest) => Promise<string>;

  constructor(
    records: RecordAppender,
    createProposal: (request: ApprovalRequest) => Promise<string>,
  ) {
    this.#records = records;
    this.#createProposal = createProposal;
  }

  request(request: ApprovalRequest): void {
    if (hashBytes(request.canonicalInput) !== request.inputDigest) {
      throw new Error("Approval input digest does not bind canonical bytes");
    }
    this.#requests.set(request.id, Object.freeze({ ...request }));
    this.#deferred.queue(request);
  }

  async decide(
    input: ApprovalDecisionInput,
  ): Promise<ApprovalOutcome> {
    const request = this.#required(input.requestId);
    const decidedAt = this.#validatePresentation(request, input);
    const proposalId = input.decision === "propose-policy"
      ? await this.#createProposal(request)
      : undefined;
    await this.#recordDecision(request, input, proposalId);
    const common = {
      request,
      decision: input.decision,
      operator: input.operator,
      decidedAt,
    };
    const outcome = proposalId === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, proposalId });
    this.#outcomes.set(input.requestId, outcome);
    this.#remember(request, input.decision);
    return outcome;
  }

  allowedForSession(request: ApprovalRequest): boolean {
    return this.#sessionAllowances.has(this.#sessionKey(request));
  }

  deferredApproved(request: ApprovalRequest): boolean {
    return this.#deferred.approved(request);
  }

  deferredQueue(): readonly ApprovalRequest[] {
    return this.#deferred.queued();
  }

  closeSession(session: string): void {
    for (const key of this.#sessionAllowances) {
      if (key.startsWith(`${session}:`)) this.#sessionAllowances.delete(key);
    }
    this.#deferred.closeSession(session);
  }

  #sessionKey(request: ApprovalRequest): string {
    return `${request.session}:${request.target}:${request.protocol}:${request.operation}`;
  }

  #required(requestId: string): ApprovalRequest {
    const request = this.#requests.get(requestId);
    if (request === undefined) throw new Error(`Unknown approval ${requestId}`);
    return request;
  }

  #validatePresentation(
    request: ApprovalRequest,
    input: ApprovalDecisionInput,
  ): string {
    const decidedAt = input.decidedAt ?? new Date().toISOString();
    validatePresentation(request, input, decidedAt);
    return decidedAt;
  }

  async #recordDecision(
    request: ApprovalRequest,
    input: ApprovalDecisionInput,
    proposalId: string | undefined,
  ): Promise<void> {
    await this.#records.append({
      type: "approval.decision",
      scope: { level: "session", id: request.session },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        request: request.id,
        decision: input.decision,
        operator: input.operator,
        inputDigest: request.inputDigest,
        ...(proposalId !== undefined && { proposalId }),
      },
    });
  }

  #remember(
    request: ApprovalRequest,
    decision: ApprovalDecisionInput["decision"],
  ): void {
    if (decision === "allow-session") {
      this.#sessionAllowances.add(this.#sessionKey(request));
    }
    if (
      request.purpose === "deferred-grant"
      && (decision === "allow-once" || decision === "allow-session")
    ) this.#deferred.remember(request);
  }
}

export type * from "./types";
