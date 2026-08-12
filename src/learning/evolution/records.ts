import type { DurabilitySchemaRegistry } from "../../audit/durability/index";
import type { Digest } from "../../core/types";
import type { RecordDurability } from "../../core/waist/types";

const OBSERVATIONAL: RecordDurability = "observational";
const EFFECT_GATING: RecordDurability = "effect-gating";

export const EVOLUTION_RECORD_DURABILITY: Readonly<
  Record<
    string,
    RecordDurability
  >
> = Object.freeze({
  "evolution.signal.detected": OBSERVATIONAL,
  "evolution.run.scoped": OBSERVATIONAL,
  "evolution.dataset.sealed": OBSERVATIONAL,
  "evolution.baseline.completed": OBSERVATIONAL,
  "evolution.engine.started": OBSERVATIONAL,
  "evolution.candidate.created": OBSERVATIONAL,
  "evolution.candidate.rejected": OBSERVATIONAL,
  "evolution.shortlist.sealed": OBSERVATIONAL,
  "evolution.evaluation.completed": OBSERVATIONAL,
  "evolution.proposal.authored": OBSERVATIONAL,
  "evolution.review.approved": EFFECT_GATING,
  "evolution.review.rejected": EFFECT_GATING,
  "evolution.release.promotion-intent": EFFECT_GATING,
  "evolution.release.rollback-intent": EFFECT_GATING,
  "evolution.git.published": EFFECT_GATING,
  "evolution.git.publication-intent": EFFECT_GATING,
  "evolution.canary.started": EFFECT_GATING,
  "evolution.canary.failed": EFFECT_GATING,
  "evolution.release.promoted": EFFECT_GATING,
  "evolution.release.monitor.completed": OBSERVATIONAL,
  "evolution.release.regression-detected": OBSERVATIONAL,
  "evolution.release.rolled-back": EFFECT_GATING,
  "evolution.run.cancelled": OBSERVATIONAL,
  "evolution.budget.exhausted": OBSERVATIONAL,
});

export const evolutionRecordDurability = (
  type: string,
): RecordDurability => EVOLUTION_RECORD_DURABILITY[type] ?? OBSERVATIONAL;

export const registerEvolutionDurabilitySchemas = (
  registry: DurabilitySchemaRegistry,
  policyDigest: Digest,
): void => {
  for (
    const [recordType, durability] of Object.entries(
      EVOLUTION_RECORD_DURABILITY,
    )
  ) {
    registry.register({ recordType, durability, policyDigest });
  }
};
