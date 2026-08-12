import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../../src/core/digest";
import { MemoryRecordAppender } from "../../../src/core/waist/records";
import {
  makeFileEvolutionCandidateValidator,
} from "../../../src/learning/evolution/application/validation";
import {
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionRun,
  EvolutionTarget,
  OptimizationEngineResult,
  OptimizingRunState,
} from "../../../src/learning/evolution/model/index";
import { makeEvolutionOrchestrator } from "../../../src/learning/evolution/orchestrator/index";
import type {
  EvolutionCandidateStoreShape,
  EvolutionRunStoreShape,
} from "../../../src/learning/evolution/types";
import { makeRun } from "../../unit/evolution/helpers";

describe("paused evolution resumption", () => {
  it("reuses the recorded seed and baseline bytes for trusted shortlisting", async () => {
    const baseline = "Baseline instructions.";
    const content = "Improved instructions.";
    const base = makeRun();
    const target = EvolutionTarget.make({
      ...base.target,
      baselineDigest: hashBytes(baseline),
      mutationPath: "skills/review/SKILL.md",
      allowedMutationPaths: ["skills/review/SKILL.md"],
      frozenPaths: ["skills/review/manifest.yaml"],
    });
    let storedRun = EvolutionRun.make({
      ...base,
      target,
      optimizationSeed: 7,
      state: OptimizingRunState.make({
        startedAt: new Date(0).toISOString(),
        candidateCount: 0,
        resumeToken: "opaque",
      }),
    });
    const storedCandidates: EvolutionCandidate[] = [];
    const runs: EvolutionRunStoreShape = {
      save: (run) =>
        Effect.sync(() => {
          storedRun = run;
          return run;
        }),
      get: () => Effect.succeed(storedRun),
      list: () => Effect.succeed([storedRun]),
    };
    const candidates: EvolutionCandidateStoreShape = {
      save: (candidate) =>
        Effect.sync(() => {
          storedCandidates.push(candidate);
          return candidate;
        }),
      get: (id) =>
        Effect.sync(() => {
          const found = storedCandidates.find((item) => item.id === id);
          if (found === undefined) throw new Error("candidate missing");
          return found;
        }),
      listForRun: () => Effect.succeed(storedCandidates),
    };
    const candidate = EvolutionCandidate.make({
      id: EvolutionCandidateIdSchema.make("evc_resumed1"),
      runId: storedRun.id,
      targetDigest: target.baselineDigest,
      candidateDigest: hashBytes(content),
      patch:
        "--- a/skills/review/SKILL.md\n+++ b/skills/review/SKILL.md\n-Baseline\n+Improved\n",
      materializedContent: content,
      engineTraceDigest: "sha256:trace",
      usage: EvolutionCandidateUsage.make({
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        latencyMilliseconds: 1,
      }),
      constraints: [],
      createdAt: new Date(1).toISOString(),
    });
    const orchestrator = makeEvolutionOrchestrator({
      runs,
      candidates,
      datasets: {
        save: Effect.succeed,
        get: () => Effect.die("not used"),
      },
      reports: {
        save: Effect.succeed,
        get: () => Effect.die("not used"),
      },
      engine: {
        describeCapabilities: () => Effect.die("not used"),
        optimize: () => Effect.die("not used"),
        pause: () => Effect.die("not used"),
        resume: (token) =>
          token === "opaque"
            ? Effect.succeed(OptimizationEngineResult.make({
              runId: storedRun.id,
              candidates: [candidate],
              paused: false,
            }))
            : Effect.die("wrong resume token"),
        cancel: () => Effect.void,
      },
      harness: { evaluate: () => Effect.die("not used") },
      records: new MemoryRecordAppender(),
      candidateValidator: makeFileEvolutionCandidateValidator(),
    });
    const shortlisted = await Effect.runPromise(orchestrator.resume({
      runId: storedRun.id,
      baselineContent: baseline,
      seed: storedRun.optimizationSeed,
      now: new Date(2).toISOString(),
    }));
    expect(shortlisted).toHaveLength(1);
    expect(storedRun.state._tag).toBe("shortlisted");
    expect(shortlisted[0]?.candidateDigest).toBe(hashBytes(content));
  });
});
