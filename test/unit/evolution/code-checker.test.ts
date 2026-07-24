import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../../src/core/digest";
import {
  makeHttpTrustedCodeChecker,
} from "../../../src/learning/evolution/application/code-checker";
import {
  makeFileEvolutionCandidateValidator,
} from "../../../src/learning/evolution/application/validation";
import {
  EvolutionCandidate,
  EvolutionCodeCheckoutFile,
  EvolutionCodeSandboxContract,
  EvolutionRun,
  EvolutionTarget,
} from "../../../src/learning/evolution/model/index";
import { makeCandidate, makeRun } from "./helpers";

const codeFixture = () => {
  const baseline = JSON.stringify({
    files: { "src/value.ts": "export const value = 1;\n" },
  });
  const materialized = JSON.stringify({
    files: { "src/value.ts": "export const value = 2;\n" },
  });
  const base = makeRun();
  const target = EvolutionTarget.make({
    ...base.target,
    targetClass: "code",
    baselineDigest: hashBytes(baseline),
    mutationPath: "src/value.ts",
    allowedMutationPaths: ["src/value.ts"],
    frozenPaths: ["component.yaml"],
  });
  const run = EvolutionRun.make({ ...base, target, engineKind: "darwinian" });
  const candidate = EvolutionCandidate.make({
    ...makeCandidate(),
    runId: run.id,
    targetDigest: target.baselineDigest,
    candidateDigest: hashBytes(materialized),
    materializedContent: materialized,
    patch: "--- a/src/value.ts\n+++ b/src/value.ts\n-1\n+2\n",
    constraints: [],
  });
  const file = EvolutionCodeCheckoutFile.make({
    path: "src/value.ts",
    digest: hashBytes("export const value = 1;\n"),
    content: "export const value = 1;\n",
    executable: false,
  });
  const sandbox = EvolutionCodeSandboxContract.make({
    checkoutRef: "candidate://code-check",
    checkoutFiles: [file],
    targetFiles: [file.path],
    testCommands: [["bun", "test"]],
    cpuQuota: 1,
    memoryMb: 512,
    pids: 64,
    timeoutMilliseconds: 30_000,
    networkEnabled: false,
    repositoryCredentialsMounted: false,
    gitRemotePresent: false,
    activeTreeWritable: false,
    containerRuntimeSocketMounted: false,
  });
  return { baseline, candidate, run, sandbox };
};

const constraintReport = (
  fixture: ReturnType<typeof codeFixture>,
  candidateId = fixture.candidate.id,
) => ({
  runId: fixture.run.id,
  candidateId,
  candidateDigest: fixture.candidate.candidateDigest,
  constraints: [
    {
      constraint: "code-focused-test",
      passed: true,
      detail: "focused reproduction passed in the isolated checker",
      evidenceDigests: ["sha256:focused"],
    },
    {
      constraint: "code-full-check",
      passed: true,
      detail: "bun run check passed in the isolated checker",
      evidenceDigests: ["sha256:full"],
    },
    {
      constraint: "code-frozen-surface",
      passed: true,
      detail: "frozen surfaces match",
      evidenceDigests: ["sha256:surface"],
    },
  ],
});

describe("trusted code candidate checker", () => {
  it("binds isolated pre-shortlist checks into trusted constraints", async () => {
    const fixture = codeFixture();
    const checker = makeHttpTrustedCodeChecker(
      "https://checker.test",
      async (_input, init) => {
        const request: unknown = JSON.parse(String(init?.body));
        expect(request).toHaveProperty("operation", "checkCandidate");
        return Response.json(constraintReport(fixture));
      },
    );
    const validated = await Effect.runPromise(
      makeFileEvolutionCandidateValidator(checker).validate(
        fixture.run,
        fixture.candidate,
        fixture.baseline,
        fixture.sandbox,
      ),
    );
    expect(validated.constraints.every((item) => item.passed)).toBeTrue();
    expect(validated.constraints.map((item) => item.constraint)).toContain(
      "code-full-check",
    );
  });

  it("rejects a checker report with drifted candidate bindings", async () => {
    const fixture = codeFixture();
    const checker = makeHttpTrustedCodeChecker(
      "https://checker.test",
      async () => Response.json(constraintReport(fixture, "evc_drifted1")),
    );
    await expect(Effect.runPromise(checker.check(
      fixture.run,
      fixture.candidate,
      fixture.sandbox,
    ))).rejects.toHaveProperty("_tag", "EvolutionEvaluationError");
  });
});
