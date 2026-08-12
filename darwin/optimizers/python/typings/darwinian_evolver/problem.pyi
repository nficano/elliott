from typing import Any, Generic, TypeVar
from uuid import UUID

from darwinian_evolver.learning_log import LearningLogEntry

OrganismT = TypeVar("OrganismT", bound="Organism")
EvaluationResultT = TypeVar("EvaluationResultT", bound="EvaluationResult")
EvaluationFailureCaseT = TypeVar(
    "EvaluationFailureCaseT",
    bound="EvaluationFailureCase",
)

class Organism:
    id: UUID
    parent: Organism | None
    from_failure_cases: list[EvaluationFailureCase] | None
    from_learning_log_entries: list[LearningLogEntry] | None
    from_change_summary: str | None

    def __init__(self, **kwargs: Any) -> None: ...

class EvaluationFailureCase:
    data_point_id: str
    failure_type: str

    def __init__(self, **kwargs: Any) -> None: ...

class EvaluationResult:
    score: float
    trainable_failure_cases: list[EvaluationFailureCase]
    holdout_failure_cases: list[EvaluationFailureCase]
    is_viable: bool

    def __init__(self, **kwargs: Any) -> None: ...

class Mutator(Generic[OrganismT, EvaluationFailureCaseT]):
    def __init__(self) -> None: ...
    @property
    def supports_batch_mutation(self) -> bool: ...
    def mutate(
        self,
        organism: OrganismT,
        failure_cases: list[EvaluationFailureCaseT],
        learning_log_entries: list[LearningLogEntry],
    ) -> list[OrganismT]: ...

class Evaluator(Generic[OrganismT, EvaluationResultT, EvaluationFailureCaseT]):
    def evaluate(self, organism: OrganismT) -> EvaluationResultT: ...

class Problem(Generic[OrganismT, EvaluationResultT, EvaluationFailureCaseT]):
    initial_organism: OrganismT
    evaluator: Evaluator[OrganismT, EvaluationResultT, EvaluationFailureCaseT]
    mutators: list[Mutator[OrganismT, EvaluationFailureCaseT]]

    def __init__(
        self,
        *,
        initial_organism: OrganismT,
        evaluator: Evaluator[OrganismT, EvaluationResultT, EvaluationFailureCaseT],
        mutators: list[Mutator[OrganismT, EvaluationFailureCaseT]],
    ) -> None: ...
