import { scopeId } from "../../core/brands";
import { hashValue } from "../../core/digest";
import type { Digest } from "../../core/types";
import type {
  CompiledSanitizerSchema,
  SanitizerDecision,
  SanitizeRequest,
  SanitizerPipelineConfig,
  SanitizerProtocol,
  TrustedEvaluatorVerdict,
} from "./types";

const cacheKey = (request: SanitizeRequest): Digest =>
  hashValue({
    source: hashValue(request.sourceContent),
    output: hashValue(request.proposedOutput),
    policy: request.policySetDigest,
    schema: request.schemaDigest,
    sanitizer: request.sanitizerComponentDigest,
  });

const rejected = (
  reason: string,
  confidence?: number,
): SanitizerDecision =>
  Object.freeze({
    isApproved: false,
    servedFromCache: false,
    violationReason: reason,
    appendSafe: false,
    ...(confidence !== undefined && { tleConfidence: confidence }),
  });

export class SanitizerPipeline implements SanitizerProtocol {
  readonly #schemas: ReadonlyMap<Digest, CompiledSanitizerSchema>;
  readonly #config: SanitizerPipelineConfig;
  readonly #cache = new Map<Digest, SanitizerDecision>();

  constructor(config: SanitizerPipelineConfig) {
    this.#config = config;
    this.#schemas = new Map(
      config.schemas.map((schema) => [schema.digest, schema]),
    );
  }

  async sanitize(request: SanitizeRequest): Promise<SanitizerDecision> {
    const preflight = await this.#preflight(request);
    if (preflight !== undefined) return preflight;
    const verdict = await this.#config.evaluator.evaluate(request);
    const key = cacheKey(request);
    const schema = this.#schemas.get(request.schemaDigest);
    return this.#afterEvaluator(request, key, { verdict, schema });
  }

  async sanitizeBatch(
    requests: readonly SanitizeRequest[],
  ): Promise<readonly SanitizerDecision[]> {
    if (requests.length === 0) return [];
    const initial = await Promise.all(
      requests.map((request) => this.#preflight(request)),
    );
    const pending = requests.filter((_, index) => initial[index] === undefined);
    const evaluated = await this.#evaluateBatch(pending);
    let evaluatedIndex = 0;
    return initial.map((decision) => {
      if (decision !== undefined) return decision;
      const resolved = evaluated[evaluatedIndex];
      evaluatedIndex += 1;
      return resolved ?? rejected("malformed-tle-batch");
    });
  }

  async #evaluateBatch(
    requests: readonly SanitizeRequest[],
  ): Promise<readonly SanitizerDecision[]> {
    if (requests.length === 0) return [];
    let verdicts: readonly TrustedEvaluatorVerdict[];
    try {
      verdicts = await this.#config.evaluator.evaluateBatch(requests);
    } catch (error) {
      void error;
      return Promise.all(
        requests.map((request) =>
          this.#auditAndReturn(request, rejected("malformed-tle-batch"))
        ),
      );
    }
    if (verdicts.length !== requests.length) {
      return Promise.all(
        requests.map((request) =>
          this.#auditAndReturn(request, rejected("malformed-tle-batch"))
        ),
      );
    }
    return Promise.all(requests.map((request, index) => {
      const verdict = verdicts[index];
      if (verdict === undefined) {
        return this.#auditAndReturn(request, rejected("malformed-tle-batch"));
      }
      const key = cacheKey(request);
      return this.#afterEvaluator(request, key, {
        verdict,
        schema: this.#schemas.get(request.schemaDigest),
      });
    }));
  }

  async #preflight(
    request: SanitizeRequest,
  ): Promise<SanitizerDecision | undefined> {
    const key = cacheKey(request);
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      return this.#auditAndReturn(
        request,
        Object.freeze({ ...cached, servedFromCache: true }),
      );
    }
    const schema = this.#schemas.get(request.schemaDigest);
    if (schema?.validate(request.proposedOutput) !== true) return undefined;
    return this.#remember(
      request,
      key,
      Object.freeze({
        isApproved: true,
        approvedVia: "schema",
        servedFromCache: false,
        sanitizedOutput: request.proposedOutput,
        appendSafe: schema.appendSafe,
      }),
    );
  }

  async #afterEvaluator(
    request: SanitizeRequest,
    key: Digest,
    evaluation: {
      readonly verdict: TrustedEvaluatorVerdict;
      readonly schema: CompiledSanitizerSchema | undefined;
    },
  ): Promise<SanitizerDecision> {
    const { verdict, schema } = evaluation;
    if (!verdict.approved) {
      return this.#remember(
        request,
        key,
        rejected(verdict.reason ?? "tle-rejected", verdict.confidence),
      );
    }
    if (schema?.validate(request.proposedOutput) === true) {
      const decision: SanitizerDecision = Object.freeze({
        isApproved: true,
        approvedVia: "schema+tle",
        servedFromCache: false,
        sanitizedOutput: request.proposedOutput,
        appendSafe: schema.appendSafe,
        ...(verdict.confidence !== undefined && {
          tleConfidence: verdict.confidence,
        }),
      });
      return this.#remember(request, key, decision);
    }
    const approved = await this.#config.humanReview.review(request);
    const decision: SanitizerDecision = approved
      ? Object.freeze({
        isApproved: true,
        approvedVia: "human",
        servedFromCache: false,
        sanitizedOutput: request.proposedOutput,
        appendSafe: false,
      })
      : rejected("human-rejected");
    await this.#audit(request, decision);
    return decision;
  }

  async #remember(
    request: SanitizeRequest,
    key: Digest,
    decision: SanitizerDecision,
  ): Promise<SanitizerDecision> {
    this.#cache.set(key, decision);
    return this.#auditAndReturn(request, decision);
  }

  async #auditAndReturn(
    request: SanitizeRequest,
    decision: SanitizerDecision,
  ): Promise<SanitizerDecision> {
    await this.#audit(request, decision);
    return decision;
  }

  async #audit(
    request: SanitizeRequest,
    decision: SanitizerDecision,
  ): Promise<void> {
    await this.#config.records.append({
      type: "sanitizer.decision",
      scope: { level: "invocation", id: scopeId(cacheKey(request)) },
      durability: "observational",
      classification: request.sourceClassification,
      payload: {
        approved: decision.isApproved,
        approvedVia: decision.approvedVia ?? "none",
        servedFromCache: decision.servedFromCache,
        appendSafe: decision.appendSafe,
        violationReason: decision.violationReason ?? "none",
      },
    });
  }
}

export type * from "./types";
