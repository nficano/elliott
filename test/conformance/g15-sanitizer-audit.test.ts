import { describe, expect, it } from "bun:test";
import { componentRef, digest } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { KernelContextManager } from "../../src/security/ifc/context-manager";
import type { MergeRequest } from "../../src/security/ifc/types";
import { SanitizerPipeline } from "../../src/security/sanitizer/sanitizer";

describe("G15 sanitizer audit and oracle resistance", () => {
  it("audits cached and fresh rejection while returning an opaque shape", async () => {
    const records = new MemoryRecordAppender();
    const pipeline = new SanitizerPipeline({
      schemas: [],
      evaluator: {
        async evaluate() {
          return { approved: false, reason: "secret matched" };
        },
        async evaluateBatch(requests) {
          return requests.map(() => ({
            approved: false,
            reason: "secret matched",
          }));
        },
      },
      humanReview: {
        async review() {
          return false;
        },
      },
      records,
      requireTrustedEvaluator: true,
    });
    const frames = new KernelContextManager(records, {
      async sanitize(request) {
        const decision = await pipeline.sanitize({
          sourceContent: request.rawOutput,
          proposedOutput: request.rawOutput,
          sourceClassification: "restricted",
          targetClassification: "internal",
          policySetDigest: digest("policy"),
          schemaDigest: digest("schema"),
          sanitizerComponentDigest: digest("sanitizer"),
        });
        return { approved: decision.isApproved };
      },
    }, false);
    const target = frames.activeFrame;
    const source = frames.fork("restricted", "sensitive work");
    const request: MergeRequest = {
      sourceFrame: source,
      sourceRevision: 0,
      targetFrame: target,
      rawOutput: "do not release",
      sanitizerComponent: componentRef("core/sanitizer/default"),
      ordering: "revision-dependent",
    };
    const first = await (await frames.merge(request)).result;
    const second = await (await frames.merge(request)).result;
    expect(first).toEqual({ type: "blocked-declassification" });
    expect(second).toEqual(first);
    const audits = records.list().filter((record) =>
      record.type === "sanitizer.decision"
    );
    expect(audits).toHaveLength(2);
    expect(audits.map((record) => record.payload.servedFromCache)).toEqual([
      false,
      true,
    ]);
  });
});
