import * as Schema from "effect/Schema";

export class EvolutionPersistenceError
  extends Schema.TaggedErrorClass<EvolutionPersistenceError>()(
    "EvolutionPersistenceError",
    {
      operation: Schema.String,
      path: Schema.String,
      cause: Schema.Defect(),
    },
  )
{}

export class EvolutionDecodeError
  extends Schema.TaggedErrorClass<EvolutionDecodeError>()(
    "EvolutionDecodeError",
    {
      artifact: Schema.String,
      cause: Schema.Defect(),
    },
  )
{}

export class EvolutionNotFoundError
  extends Schema.TaggedErrorClass<EvolutionNotFoundError>()(
    "EvolutionNotFoundError",
    {
      artifact: Schema.String,
      id: Schema.String,
    },
  )
{}

export class EvolutionTransitionError
  extends Schema.TaggedErrorClass<EvolutionTransitionError>()(
    "EvolutionTransitionError",
    {
      runId: Schema.String,
      from: Schema.String,
      to: Schema.String,
    },
  )
{}

export class EvolutionAuthorityError
  extends Schema.TaggedErrorClass<EvolutionAuthorityError>()(
    "EvolutionAuthorityError",
    {
      principalId: Schema.String,
      action: Schema.String,
      reason: Schema.String,
    },
  )
{}

export class EvolutionStaleTargetError
  extends Schema.TaggedErrorClass<EvolutionStaleTargetError>()(
    "EvolutionStaleTargetError",
    {
      targetRef: Schema.String,
      expectedDigest: Schema.String,
      activeDigest: Schema.String,
    },
  )
{}

export class EvolutionBudgetError
  extends Schema.TaggedErrorClass<EvolutionBudgetError>()(
    "EvolutionBudgetError",
    {
      budget: Schema.String,
      observed: Schema.Number,
      limit: Schema.Number,
    },
  )
{}

export class EvolutionContainmentError
  extends Schema.TaggedErrorClass<EvolutionContainmentError>()(
    "EvolutionContainmentError",
    {
      root: Schema.String,
      requestedPath: Schema.String,
    },
  )
{}

export class EvolutionEngineError
  extends Schema.TaggedErrorClass<EvolutionEngineError>()(
    "EvolutionEngineError",
    {
      engineRef: Schema.String,
      operation: Schema.String,
      cause: Schema.Defect(),
    },
  )
{}

export class EvolutionEvaluationError
  extends Schema.TaggedErrorClass<EvolutionEvaluationError>()(
    "EvolutionEvaluationError",
    {
      evaluatorRef: Schema.String,
      operation: Schema.String,
      cause: Schema.Defect(),
    },
  )
{}

export class EvolutionDatasetError
  extends Schema.TaggedErrorClass<EvolutionDatasetError>()(
    "EvolutionDatasetError",
    {
      operation: Schema.String,
      reason: Schema.String,
      caseIds: Schema.Array(Schema.String),
    },
  )
{}

export class EvolutionConstraintError
  extends Schema.TaggedErrorClass<EvolutionConstraintError>()(
    "EvolutionConstraintError",
    {
      targetRef: Schema.String,
      constraint: Schema.String,
      reason: Schema.String,
    },
  )
{}

export class EvolutionPromotionError
  extends Schema.TaggedErrorClass<EvolutionPromotionError>()(
    "EvolutionPromotionError",
    {
      proposalId: Schema.String,
      stage: Schema.String,
      reason: Schema.String,
      cause: Schema.optionalKey(Schema.Defect()),
    },
  )
{}

export class EvolutionAcceptanceArtifactError
  extends Schema.TaggedErrorClass<EvolutionAcceptanceArtifactError>()(
    "EvolutionAcceptanceArtifactError",
    {
      artifact: Schema.String,
      id: Schema.String,
      cause: Schema.optionalKey(Schema.Defect()),
    },
  )
{}
