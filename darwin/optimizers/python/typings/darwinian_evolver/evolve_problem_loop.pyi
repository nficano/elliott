from collections.abc import Generator, Iterable
from typing import Any

from darwinian_evolver.problem import EvaluationResult, Organism

class IterationSnapshot:
    iteration: int
    population_size: int
    best_organism_result: tuple[Any, EvaluationResult]

class _PopulationView:
    organisms: Iterable[tuple[Any, EvaluationResult]]

class EvolveProblemLoop:
    population: _PopulationView

    def __init__(self, problem: Any, **kwargs: Any) -> None: ...
    def run(self, num_iterations: int) -> Generator[IterationSnapshot, None, None]: ...
