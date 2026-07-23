import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { SanitizerPipeline } from "../../src/security/sanitizer/sanitizer";
import type { SanitizeRequest } from "../../src/security/sanitizer/types";

const request = (): SanitizeRequest => ({
  sourceContent: "source",
  proposedOutput: "output",
  sourceClassification: "restricted",
  targetClassification: "internal",
  policySetDigest: digest("policy"),
  schemaDigest: digest("schema"),
  sanitizerComponentDigest: digest("sanitizer"),
});

describe("G19 sanitizer cache soundness", () => {
  it("covers every judgment input and preserves batched verdicts", async () => {
    let evaluations = 0;
    const pipeline = new SanitizerPipeline({
      schemas: [],
      evaluator: {
        async evaluate() {
          evaluations += 1;
          return { approved: false, reason: "blocked" };
        },
        async evaluateBatch(requests) {
          evaluations += requests.length;
          return requests.map(() => ({ approved: false, reason: "blocked" }));
        },
      },
      humanReview: {
        async review() {
          return false;
        },
      },
      records: new MemoryRecordAppender(),
      requireTrustedEvaluator: true,
    });
    const base = request();
    await pipeline.sanitize(base);
    await pipeline.sanitize(base);
    await pipeline.sanitize({ ...base, sourceContent: "changed" });
    await pipeline.sanitize({ ...base, proposedOutput: "changed" });
    await pipeline.sanitize({ ...base, policySetDigest: digest("changed") });
    await pipeline.sanitize({ ...base, schemaDigest: digest("changed") });
    await pipeline.sanitize({
      ...base,
      sanitizerComponentDigest: digest("changed"),
    });
    expect(evaluations).toBe(6);
    const batch = await pipeline.sanitizeBatch([
      { ...base, sourceContent: "batch-a" },
      { ...base, sourceContent: "batch-b" },
    ]);
    expect(batch.map((decision) => decision.isApproved)).toEqual([
      false,
      false,
    ]);
  });
});
