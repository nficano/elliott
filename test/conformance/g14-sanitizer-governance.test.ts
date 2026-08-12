import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { SanitizerPipeline } from "../../src/security/sanitizer/sanitizer";
import type { SanitizeRequest } from "../../src/security/sanitizer/types";

describe("G14 sanitizer governance", () => {
  it("never lets the TLE alone approve restricted free text", async () => {
    let reviews = 0;
    const pipeline = new SanitizerPipeline({
      schemas: [],
      evaluator: {
        async evaluate() {
          return { approved: true, confidence: 1 };
        },
        async evaluateBatch(requests) {
          return requests.map(() => ({ approved: true, confidence: 1 }));
        },
      },
      humanReview: {
        async review() {
          reviews += 1;
          return true;
        },
      },
      records: new MemoryRecordAppender(),
      requireTrustedEvaluator: true,
    });
    const request: SanitizeRequest = {
      sourceContent: "private source",
      proposedOutput: "free text",
      sourceClassification: "restricted",
      targetClassification: "internal",
      policySetDigest: digest("policy"),
      schemaDigest: digest("missing-schema"),
      sanitizerComponentDigest: digest("sanitizer"),
    };
    expect((await pipeline.sanitize(request)).approvedVia).toBe("human");
    expect((await pipeline.sanitize(request)).servedFromCache).toBe(false);
    expect(reviews).toBe(2);
  });
});
