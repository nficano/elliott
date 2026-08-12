import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  DatasetReadyRunState,
  EvaluatedRunState,
  EvolutionDatasetIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionTransitionContext,
} from "../../../src/learning/evolution/model/index";
import { transitionEvolutionRun } from "../../../src/learning/evolution/state";
import { makeRun, transitionContext } from "./helpers";

describe("evolution state machine", () => {
  it("accepts only declared predecessors", async () => {
    const run = makeRun();
    const next = DatasetReadyRunState.make({
      datasetId: EvolutionDatasetIdSchema.make("evd_12345678"),
      datasetDigest: "sha256:dataset",
    });
    const updated = await Effect.runPromise(
      transitionEvolutionRun(run, next, transitionContext()),
    );
    expect(updated.state._tag).toBe("dataset-ready");
    await expect(
      Effect.runPromise(
        transitionEvolutionRun(
          run,
          EvaluatedRunState.make({
            reportId: EvolutionEvaluationReportIdSchema.make("eve_12345678"),
            passed: true,
          }),
          transitionContext(),
        ),
      ),
    ).rejects.toHaveProperty("_tag", "EvolutionTransitionError");
  });

  it("rejects stale targets and authority mismatches", async () => {
    const run = makeRun();
    const next = DatasetReadyRunState.make({
      datasetId: EvolutionDatasetIdSchema.make("evd_12345678"),
      datasetDigest: "sha256:dataset",
    });
    await expect(
      Effect.runPromise(
        transitionEvolutionRun(
          run,
          next,
          EvolutionTransitionContext.make({
            ...transitionContext(),
            activeTargetDigest: "sha256:changed",
          }),
        ),
      ),
    ).rejects.toHaveProperty("_tag", "EvolutionStaleTargetError");
    await expect(
      Effect.runPromise(
        transitionEvolutionRun(
          run,
          next,
          EvolutionTransitionContext.make({
            ...transitionContext(),
            principalId: "other",
          }),
        ),
      ),
    ).rejects.toHaveProperty("_tag", "EvolutionAuthorityError");
  });
});
