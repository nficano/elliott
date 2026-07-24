import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionEvaluationError } from "../errors";
import {
  EvolutionCodeCheckReport,
  EvolutionCodeCheckRequest,
  EvolutionConstraintResult,
} from "../model/index";
import type { EvolutionTrustedCodeCheckerShape } from "../orchestrator/types";

const REQUIRED_CODE_CONSTRAINTS = new Set([
  "code-focused-test",
  "code-full-check",
  "code-frozen-surface",
]);

export const makeHttpTrustedCodeChecker = (
  endpoint: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): EvolutionTrustedCodeCheckerShape => ({
  check: (run, candidate, codeSandbox) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetchImplementation(
          new URL("/v1/candidate/check", endpoint),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(EvolutionCodeCheckRequest.make({
              operation: "checkCandidate",
              run,
              candidate,
              codeSandbox,
            })),
          },
        );
        if (!response.ok) {
          throw new Error(`candidate checker returned HTTP ${response.status}`);
        }
        const report = Schema.decodeUnknownSync(EvolutionCodeCheckReport)(
          await response.json(),
        );
        if (
          report.runId !== run.id
          || report.candidateId !== candidate.id
          || report.candidateDigest !== candidate.candidateDigest
        ) throw new Error("candidate checker returned mismatched bindings");
        const names = new Set(
          report.constraints.map((item) => item.constraint),
        );
        if (
          names.size !== REQUIRED_CODE_CONSTRAINTS.size
          || [...REQUIRED_CODE_CONSTRAINTS].some((name) => !names.has(name))
        ) throw new Error("candidate checker returned incomplete constraints");
        return report.constraints.map((item) =>
          EvolutionConstraintResult.make(item)
        );
      },
      catch: (cause) =>
        EvolutionEvaluationError.make({
          evaluatorRef: "organization/evaluator/code-checker",
          operation: "check-code-candidate",
          cause,
        }),
    }),
});
