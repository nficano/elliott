import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { hashBytes } from "../../../src/core/digest";
import { MemoryRecordAppender } from "../../../src/core/waist/records";
import {
  evolutionCandidateDominates,
  paretoEvolutionShortlist,
} from "../../../src/learning/evolution/candidates/pareto";
import {
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionRun,
  OptimizingRunState,
} from "../../../src/learning/evolution/model/index";
import { completeOptimization } from "../../../src/learning/evolution/orchestrator/optimization-completion";
import type { EvolutionOrchestratorDependencies } from "../../../src/learning/evolution/orchestrator/types";
import { makeCandidate, makeRun } from "./helpers";

const candidate = (input: {
  readonly id: string;
  readonly quality: number;
  readonly content: string;
  readonly costUsd: number;
  readonly latencyMilliseconds: number;
}): EvolutionCandidate =>
  EvolutionCandidate.make({
    ...makeCandidate(),
    id: EvolutionCandidateIdSchema.make(input.id),
    candidateDigest: hashBytes(input.content),
    materializedContent: input.content,
    validationScore: input.quality,
    usage: EvolutionCandidateUsage.make({
      inputTokens: 1,
      outputTokens: 1,
      costUsd: input.costUsd,
      latencyMilliseconds: input.latencyMilliseconds,
    }),
  });

const candidates = () => {
  const quality = candidate({
    id: "evc_quality01",
    quality: 0.9,
    content: "substantially higher quality response",
    costUsd: 2,
    latencyMilliseconds: 20,
  });
  const efficient = candidate({
    id: "evc_efficient",
    quality: 0.8,
    content: "small",
    costUsd: 1,
    latencyMilliseconds: 10,
  });
  const dominated = candidate({
    id: "evc_dominated",
    quality: 0.7,
    content: "larger content",
    costUsd: 2,
    latencyMilliseconds: 20,
  });
  return { dominated, efficient, quality };
};

describe("evolution Pareto shortlist", () => {
  it("retains quality/efficiency tradeoffs and removes dominated candidates", () => {
    const values = candidates();
    expect(
      paretoEvolutionShortlist([
        values.dominated,
        values.efficient,
        values.quality,
      ]).map((item) => item.id),
    ).toEqual(["evc_quality01", "evc_efficient"]);
    expect(
      evolutionCandidateDominates(values.efficient, values.dominated),
    ).toBeTrue();
    expect(
      evolutionCandidateDominates(values.quality, values.efficient),
    ).toBeFalse();
  });

  it("seals only the Pareto frontier and records dominated fitness", async () => {
    const values = candidates();
    const records = new MemoryRecordAppender();
    let storedRun = EvolutionRun.make({
      ...makeRun(),
      state: OptimizingRunState.make({
        startedAt: new Date(0).toISOString(),
        candidateCount: 3,
      }),
    });
    const dependencies = {
      runs: {
        save: (run) =>
          Effect.sync(() => {
            storedRun = run;
            return run;
          }),
        get: () => Effect.succeed(storedRun),
        list: () => Effect.succeed([storedRun]),
      },
      candidates: {
        save: Effect.succeed,
        get: () => Effect.die("not used"),
        listForRun: () => Effect.die("not used"),
      },
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
        resume: () => Effect.die("not used"),
        cancel: () => Effect.die("not used"),
      },
      harness: { evaluate: () => Effect.die("not used") },
      records,
    } satisfies EvolutionOrchestratorDependencies;
    const shortlist = await Effect.runPromise(completeOptimization({
      run: storedRun,
      candidates: [values.dominated, values.efficient, values.quality],
      input: {
        runId: storedRun.id,
        baselineContent: "baseline",
        seed: 1,
        now: new Date(1).toISOString(),
      },
    }, dependencies));
    expect(shortlist.map((item) => item.id)).toEqual([
      "evc_quality01",
      "evc_efficient",
    ]);
    expect(storedRun.state).toMatchObject({
      _tag: "shortlisted",
      candidateIds: ["evc_quality01", "evc_efficient"],
    });
    expect(
      records.list().find((event) =>
        event.type === "evolution.candidate.rejected"
      )?.payload,
    ).toMatchObject({
      candidateId: "evc_dominated",
      reason: "pareto-dominated",
      dominatedBy: ["evc_efficient"],
    });
  });
});
