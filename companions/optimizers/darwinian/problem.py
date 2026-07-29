from __future__ import annotations

import json
import math
import os
import random
import resource
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from darwinian_evolver.evolve_problem_loop import EvolveProblemLoop
from darwinian_evolver.learning_log import LearningLogEntry
from darwinian_evolver.learning_log_view import AncestorLearningLogView
from darwinian_evolver.problem import (
    EvaluationFailureCase,
    EvaluationResult,
    Evaluator,
    Mutator,
    Organism,
    Problem,
)
from companions.optimizers.python.worker import WireError, canonical_json
from openai import OpenAI

UPSTREAM_REVISION = "7f12365d2059c47e29068a5a6f498a293148d2a9"
MAX_DIAGNOSTIC_CHARACTERS = 8_192
MAX_MUTATION_CHARACTERS = 5_000_000


class CodeOrganism(Organism):
    files: dict[str, str]
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0
    latency_milliseconds: int = 0


class CommandFailure(EvaluationFailureCase):
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str


class CommandEvaluator(Evaluator[CodeOrganism, EvaluationResult, CommandFailure]):
    def __init__(self, request: dict[str, Any]) -> None:
        self.request = request
        self.sandbox = request["codeSandbox"]

    def _limits(self) -> None:
        memory = self.sandbox["memoryMb"] * 1024 * 1024
        cpu_seconds = max(1, math.ceil(self.sandbox["timeoutMilliseconds"] / 1000))
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        try:
            resource.setrlimit(
                resource.RLIMIT_NPROC, (self.sandbox["pids"], self.sandbox["pids"])
            )
        except (ValueError, OSError):
            pass

    def _checkout(self, organism: CodeOrganism, root: Path) -> None:
        for file in self.sandbox["checkoutFiles"]:
            destination = root / file["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(file["content"], encoding="utf-8")
            destination.chmod(0o700 if file["executable"] else 0o600)
        for path, content in organism.files.items():
            destination = root / path
            destination.write_text(content, encoding="utf-8")
        dependencies = Path("/opt/elliott/node_modules")
        if dependencies.is_dir() and not (root / "node_modules").exists():
            (root / "node_modules").symlink_to(dependencies, target_is_directory=True)

    def evaluate(self, organism: CodeOrganism) -> EvaluationResult:
        failures: list[CommandFailure] = []
        with tempfile.TemporaryDirectory(prefix="elliott-candidate-") as raw_root:
            root = Path(raw_root)
            self._checkout(organism, root)
            environment = {
                "HOME": raw_root,
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "NODE_ENV": "test",
                "NODE_PATH": "/opt/elliott/node_modules",
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "PYTHONHASHSEED": str(self.request["seed"]),
                "TMPDIR": raw_root,
            }
            timeout_seconds = self.sandbox["timeoutMilliseconds"] / 1000
            for index, command in enumerate(self.sandbox["testCommands"]):
                try:
                    completed = subprocess.run(
                        command,
                        cwd=root,
                        env=environment,
                        stdin=subprocess.DEVNULL,
                        capture_output=True,
                        check=False,
                        shell=False,
                        timeout=timeout_seconds,
                        preexec_fn=self._limits,
                    )
                    if completed.returncode == 0:
                        continue
                    failures.append(
                        CommandFailure(
                            data_point_id=f"command-{index}",
                            command=command,
                            exit_code=completed.returncode,
                            stdout=completed.stdout.decode("utf-8", errors="replace")[
                                -MAX_DIAGNOSTIC_CHARACTERS:
                            ],
                            stderr=completed.stderr.decode("utf-8", errors="replace")[
                                -MAX_DIAGNOSTIC_CHARACTERS:
                            ],
                        )
                    )
                except subprocess.TimeoutExpired as error:
                    failures.append(
                        CommandFailure(
                            data_point_id=f"command-{index}",
                            failure_type="timeout",
                            command=command,
                            exit_code=124,
                            stdout=(error.stdout or b"").decode(
                                "utf-8", errors="replace"
                            )[-MAX_DIAGNOSTIC_CHARACTERS:],
                            stderr=(error.stderr or b"").decode(
                                "utf-8", errors="replace"
                            )[-MAX_DIAGNOSTIC_CHARACTERS:],
                        )
                    )
        command_count = len(self.sandbox["testCommands"])
        score = (command_count - len(failures)) / command_count
        return EvaluationResult(
            score=score,
            trainable_failure_cases=failures,
            holdout_failure_cases=[],
            is_viable=True,
        )


class UsageBudget:
    def __init__(self, request: dict[str, Any]) -> None:
        self.maximum_tokens = request["maximumTokens"]
        self.maximum_cost = request["maximumCostUsd"]
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0
        self.lock = threading.Lock()

    def add(self, input_tokens: int, output_tokens: int, cost_usd: float) -> None:
        with self.lock:
            next_tokens = (
                self.input_tokens + self.output_tokens + input_tokens + output_tokens
            )
            next_cost = self.cost_usd + cost_usd
            if next_tokens > self.maximum_tokens:
                raise WireError("Darwinian mutation exceeded the token budget")
            if next_cost > self.maximum_cost:
                raise WireError("Darwinian mutation exceeded the cost budget")
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            self.cost_usd = next_cost


def _proxy_client() -> tuple[OpenAI, str, float, float]:
    endpoint = os.getenv("ELLIOTT_MODEL_PROXY_ENDPOINT", "")
    token = os.getenv("ELLIOTT_MODEL_PROXY_TOKEN", "")
    model = os.getenv("ELLIOTT_DARWINIAN_MODEL", "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise WireError(
            "ELLIOTT_MODEL_PROXY_ENDPOINT must be an HTTP loopback endpoint"
        )
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise WireError(
            "model proxy endpoint may not contain credentials, query, or fragment"
        )
    if not token or not model:
        raise WireError(
            "a short-lived model proxy token and Darwinian model route are required"
        )
    input_rate = float(os.getenv("ELLIOTT_MODEL_PROXY_INPUT_USD_PER_MILLION", "0"))
    output_rate = float(os.getenv("ELLIOTT_MODEL_PROXY_OUTPUT_USD_PER_MILLION", "0"))
    if input_rate < 0 or output_rate < 0:
        raise WireError("model route token rates may not be negative")
    return (
        OpenAI(base_url=endpoint.rstrip("/"), api_key=token),
        model,
        input_rate,
        output_rate,
    )


class CodeMutator(Mutator[CodeOrganism, CommandFailure]):
    def __init__(self, request: dict[str, Any], budget: UsageBudget) -> None:
        super().__init__()
        self.request = request
        self.budget = budget

    @property
    def supports_batch_mutation(self) -> bool:
        return True

    def mutate(
        self,
        organism: CodeOrganism,
        failure_cases: list[CommandFailure],
        learning_log_entries: list[LearningLogEntry],
    ) -> list[CodeOrganism]:
        client, model, input_rate, output_rate = _proxy_client()
        target_files = self.request["codeSandbox"]["targetFiles"]
        prompt = canonical_json(
            {
                "task": (
                    "Repair the failed checks by changing only the listed target files. "
                    "Return one JSON object with a `files` object containing complete replacement "
                    "text for every changed target file. Do not use Markdown fences."
                ),
                "targetFiles": target_files,
                "currentFiles": organism.files,
                "failures": [
                    {
                        "command": failure.command,
                        "exitCode": failure.exit_code,
                        "stdout": failure.stdout,
                        "stderr": failure.stderr,
                    }
                    for failure in failure_cases
                ],
                "priorAttempts": [
                    {
                        "change": entry.attempted_change,
                        "outcome": entry.observed_outcome,
                    }
                    for entry in learning_log_entries[-5:]
                ],
            }
        )
        started = time.monotonic()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an isolated code-repair mutator. Obey the JSON output contract.",
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            seed=self.request["seed"],
            max_tokens=min(self.request["maximumTokens"], 32_768),
        )
        elapsed_ms = round((time.monotonic() - started) * 1000)
        content = response.choices[0].message.content
        if not isinstance(content, str) or len(content) > MAX_MUTATION_CHARACTERS:
            raise WireError("mutation response was empty or too large")
        value = json.loads(content)
        changed_files = value.get("files") if isinstance(value, dict) else None
        if not isinstance(changed_files, dict) or not changed_files:
            raise WireError("mutation response must contain a non-empty files object")
        if not all(
            isinstance(path, str)
            and path in target_files
            and isinstance(file_content, str)
            for path, file_content in changed_files.items()
        ):
            raise WireError("mutation changed a file outside targetFiles")
        next_files = dict(organism.files)
        next_files.update(changed_files)
        if next_files == organism.files:
            return []
        usage = response.usage
        input_tokens = int(usage.prompt_tokens if usage is not None else 0)
        output_tokens = int(usage.completion_tokens if usage is not None else 0)
        cost_usd = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
        model_cost = getattr(response, "model_extra", None)
        if isinstance(model_cost, dict) and isinstance(
            model_cost.get("cost"), (int, float)
        ):
            cost_usd = float(model_cost["cost"])
        self.budget.add(input_tokens, output_tokens, cost_usd)
        return [
            CodeOrganism(
                files=next_files,
                parent=organism,
                from_failure_cases=failure_cases,
                from_learning_log_entries=learning_log_entries,
                from_change_summary=f"Changed {', '.join(sorted(changed_files))}",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                latency_milliseconds=elapsed_ms,
            )
        ]


def run_evolution(
    request: dict[str, Any],
) -> list[tuple[CodeOrganism, EvaluationResult]]:
    random.seed(request["seed"])
    try:
        import numpy

        numpy.random.seed(request["seed"] % (2**32))
    except ImportError:
        pass
    sandbox = request["codeSandbox"]
    by_path = {file["path"]: file["content"] for file in sandbox["checkoutFiles"]}
    initial = CodeOrganism(
        files={path: by_path[path] for path in sandbox["targetFiles"]}
    )
    evaluator = CommandEvaluator(request)
    baseline_result = evaluator.evaluate(initial)
    if not baseline_result.trainable_failure_cases:
        return []
    budget = UsageBudget(request)
    problem = Problem[CodeOrganism, EvaluationResult, CommandFailure](
        initial_organism=initial,
        evaluator=evaluator,
        mutators=[CodeMutator(request, budget)],
    )
    loop = EvolveProblemLoop(
        problem,
        learning_log_view_type=(AncestorLearningLogView, {"max_depth": 5}),
        num_parents_per_iteration=1,
        mutator_concurrency=1,
        evaluator_concurrency=min(request["maximumConcurrency"], 8),
        batch_size=min(len(baseline_result.trainable_failure_cases), 8),
        should_verify_mutations=False,
        fixed_children_per_generation=[1],
        use_process_pool_executors=False,
    )
    maximum = min(request["maximumCandidates"], 20)
    final_snapshot = None
    for snapshot in loop.run(num_iterations=maximum):
        final_snapshot = snapshot
        best_organism, best_result = snapshot.best_organism_result
        if best_organism.parent is not None and best_result.score >= 1:
            break
        if snapshot.population_size >= maximum + 1:
            break
    if final_snapshot is None:
        return []
    return [
        (organism, result)
        for organism, result in loop.population.organisms
        if organism.parent is not None
    ][:maximum]
