import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  makeFileEvolutionAcceptanceReader,
} from "../../../src/learning/evolution/acceptance/file-state";
import {
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRunIdSchema,
} from "../../../src/learning/evolution/model/index";

describe("makeFileEvolutionAcceptanceReader", () => {
  it("maps missing artifact reads into acceptance errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-accept-"));
    try {
      const reader = await Effect.runPromise(
        makeFileEvolutionAcceptanceReader(root),
      );
      await expect(
        Effect.runPromise(
          reader.release(EvolutionReleaseIdSchema.make("evl_missing1")),
        ),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
      await expect(
        Effect.runPromise(
          reader.run(EvolutionRunIdSchema.make("evr_missing1")),
        ),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
      await expect(
        Effect.runPromise(
          reader.candidate(EvolutionCandidateIdSchema.make("evc_missing1")),
        ),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
      await expect(
        Effect.runPromise(
          reader.dataset(EvolutionDatasetIdSchema.make("evd_missing1")),
        ),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
      await expect(
        Effect.runPromise(
          reader.report(
            EvolutionEvaluationReportIdSchema.make("eve_missing1"),
          ),
        ),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
      await expect(
        Effect.runPromise(reader.proposal("missing-proposal")),
      ).rejects.toHaveProperty("_tag", "EvolutionAcceptanceArtifactError");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
