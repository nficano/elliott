from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.request
import uuid
from typing import Any
from urllib.parse import urlparse

from benchmark_worker import run_benchmark
from elliott_companion.wire import (
    MAX_RESPONSE_BYTES,
    RUN_ID,
    WireError,
    canonical_json,
    require_int,
    require_mapping,
    require_number,
    require_string,
    sha256_text,
    utc_now,
)

CANDIDATE_ID = re.compile(r"^evc_[a-z0-9][a-z0-9_-]{7,127}$")
SPLITS = ("train", "validation", "holdout")
FOOTPRINT_CATEGORIES = ("prompt", "inference", "runtime")
MAXIMUM_FINITE_RATIO = 1.7976931348623157e308
LCG_MULTIPLIER = 1_664_525
LCG_INCREMENT = 1_013_904_223
LCG_MODULUS = 0x1_00_00_00_00


def _require_array(value: Any, name: str, *, nonempty: bool = False) -> list[Any]:
    if not isinstance(value, list) or (nonempty and not value):
        suffix = " non-empty" if nonempty else ""
        raise WireError(f"{name} must be a{suffix} array")
    return value


def _require_boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise WireError(f"{name} must be boolean")
    return value


def _validate_run_candidate_dataset(request: dict[str, Any]) -> None:
    run = require_mapping(request.get("run"), "run")
    candidate = require_mapping(request.get("candidate"), "candidate")
    dataset = require_mapping(request.get("dataset"), "dataset")
    run_id = require_string(run.get("id"), "run.id")
    candidate_id = require_string(candidate.get("id"), "candidate.id")
    if RUN_ID.fullmatch(run_id) is None or CANDIDATE_ID.fullmatch(candidate_id) is None:
        raise WireError("run or candidate id is invalid")
    state = require_mapping(run.get("state"), "run.state")
    candidate_ids = _require_array(
        state.get("candidateIds"),
        "run.state.candidateIds",
        nonempty=True,
    )
    if state.get("_tag") != "shortlisted" or candidate_id not in candidate_ids:
        raise WireError("candidate is not in a sealed shortlist")
    target = require_mapping(run.get("target"), "run.target")
    baseline_digest = require_string(
        target.get("baselineDigest"),
        "run.target.baselineDigest",
    )
    if (
        candidate.get("runId") != run_id
        or candidate.get("targetDigest") != baseline_digest
    ):
        raise WireError("candidate is not bound to the run target")
    if (
        dataset.get("id") != run.get("datasetId")
        or dataset.get("digest") != run.get("datasetDigest")
        or dataset.get("targetDigest") != baseline_digest
        or dataset.get("holdoutSealed") is not True
    ):
        raise WireError("sealed dataset is not bound to the run target")
    split_digests = require_mapping(dataset.get("splitDigests"), "splitDigests")
    for split in SPLITS:
        require_string(split_digests.get(split), f"splitDigests.{split}")
    cases = _require_array(dataset.get("cases"), "dataset.cases", nonempty=True)
    observed_splits: set[str] = set()
    case_ids: set[str] = set()
    for index, raw_case in enumerate(cases):
        case = require_mapping(raw_case, f"dataset.cases[{index}]")
        case_id = require_string(case.get("id"), f"dataset.cases[{index}].id")
        split = require_string(case.get("split"), f"dataset.cases[{index}].split")
        if split not in SPLITS or case_id in case_ids:
            raise WireError("dataset cases must have unique ids and valid splits")
        require_int(
            case.get("timeoutMilliseconds"),
            f"dataset.cases[{index}].timeoutMilliseconds",
            minimum=1,
        )
        require_number(
            case.get("maximumCostUsd"),
            f"dataset.cases[{index}].maximumCostUsd",
            minimum=0,
        )
        observed_splits.add(split)
        case_ids.add(case_id)
    if observed_splits != set(SPLITS):
        raise WireError("comparison datasets must contain every split")


def _validate_constraints(request: dict[str, Any]) -> None:
    required = _require_array(request.get("requiredConstraints"), "constraints")
    if not all(isinstance(item, str) and item for item in required):
        raise WireError("required constraints must be non-empty strings")
    candidate = require_mapping(request.get("candidate"), "candidate")
    results = _require_array(candidate.get("constraints"), "candidate.constraints")
    by_name: dict[str, dict[str, Any]] = {}
    for index, raw_result in enumerate(results):
        result = require_mapping(raw_result, f"candidate.constraints[{index}]")
        name = require_string(
            result.get("constraint"),
            f"candidate.constraints[{index}].constraint",
        )
        if name in by_name:
            raise WireError("candidate constraints must be unique")
        by_name[name] = result
    missing = [
        name
        for name in required
        if name not in by_name or by_name[name].get("passed") is not True
    ]
    if missing:
        raise WireError(f"required candidate constraints failed: {missing!r}")


def _validate_metric_definitions(request: dict[str, Any]) -> None:
    metrics = _require_array(request.get("metrics"), "metrics", nonempty=True)
    names: set[str] = set()
    for index, raw_metric in enumerate(metrics):
        metric = require_mapping(raw_metric, f"metrics[{index}]")
        name = require_string(metric.get("name"), f"metrics[{index}].name")
        if name in names or metric.get("direction") not in {"maximize", "minimize"}:
            raise WireError("metric names must be unique and directions valid")
        require_number(metric.get("weight"), f"metrics[{index}].weight")
        require_number(
            metric.get("regressionFloor"),
            f"metrics[{index}].regressionFloor",
        )
        names.add(name)


def _validate_metrics(request: dict[str, Any]) -> None:
    _validate_metric_definitions(request)
    confidence = require_number(request.get("confidenceLevel"), "confidenceLevel")
    if confidence <= 0 or confidence >= 1:
        raise WireError("confidenceLevel must be between zero and one")
    require_int(request.get("bootstrapIterations"), "bootstrapIterations", minimum=1)
    require_int(
        request.get("multipleComparisonCount"),
        "multipleComparisonCount",
        minimum=1,
    )


def _validate_footprints(request: dict[str, Any]) -> None:
    limits = _require_array(
        request.get("footprintLimits"),
        "footprintLimits",
        nonempty=True,
    )
    categories: set[str] = set()
    for index, raw_limit in enumerate(limits):
        limit = require_mapping(raw_limit, f"footprintLimits[{index}]")
        category = require_string(
            limit.get("category"),
            f"footprintLimits[{index}].category",
        )
        if category not in FOOTPRINT_CATEGORIES or category in categories:
            raise WireError("footprint limits must cover unique required categories")
        require_string(limit.get("metric"), f"footprintLimits[{index}].metric")
        require_number(
            limit.get("baseline"),
            f"footprintLimits[{index}].baseline",
            minimum=0,
        )
        require_number(
            limit.get("maximumRegressionRatio"),
            f"footprintLimits[{index}].maximumRegressionRatio",
            minimum=0,
        )
        categories.add(category)
    if categories != set(FOOTPRINT_CATEGORIES):
        raise WireError("prompt, inference, and runtime limits are required")


def _configured_benchmark_refs() -> set[str]:
    raw_path = os.getenv(
        "ELLIOTT_BENCHMARK_DRIVER_CONFIG",
        "/opt/elliott/benchmark-drivers.json",
    )
    with open(raw_path, encoding="utf-8") as source:
        configuration = require_mapping(json.load(source), "benchmark configuration")
    return set(require_mapping(configuration.get("drivers"), "benchmark drivers"))


def _validate_benchmarks(request: dict[str, Any]) -> None:
    gates = _require_array(
        request.get("benchmarkGates"),
        "benchmarkGates",
        nonempty=True,
    )
    references: set[str] = set()
    for index, raw_gate in enumerate(gates):
        gate = require_mapping(raw_gate, f"benchmarkGates[{index}]")
        reference = require_string(
            gate.get("benchmarkRef"),
            f"benchmarkGates[{index}].benchmarkRef",
        )
        if reference in references:
            raise WireError("benchmark gates must be unique")
        if gate.get("operation") not in {"runSubset", "runFull", "compareBaseline"}:
            raise WireError("benchmark gate operation is invalid")
        applicable = _require_boolean(
            gate.get("applicable"),
            f"benchmarkGates[{index}].applicable",
        )
        if not applicable:
            require_string(
                gate.get("notApplicableReason"),
                f"benchmarkGates[{index}].notApplicableReason",
            )
        references.add(reference)
    if references != _configured_benchmark_refs():
        raise WireError("request does not contain the complete benchmark ladder")


def validate_evaluation_request(value: Any) -> dict[str, Any]:
    request = require_mapping(value, "request")
    if request.get("operation") != "compare":
        raise WireError("unsupported evaluation operation")
    _validate_run_candidate_dataset(request)
    _validate_constraints(request)
    _validate_metrics(request)
    _validate_footprints(request)
    _validate_benchmarks(request)
    run = require_mapping(request.get("run"), "run")
    if request.get("baselineSnapshotId") != run.get("baselineSnapshotId"):
        raise WireError("baseline Snapshot is not bound to the run")
    baseline_snapshot = require_string(
        request.get("baselineSnapshotId"),
        "baselineSnapshotId",
    )
    candidate_snapshot = require_string(
        request.get("candidateSnapshotId"),
        "candidateSnapshotId",
    )
    if baseline_snapshot == candidate_snapshot:
        raise WireError("candidate evaluation requires a distinct Snapshot")
    authoring_route = require_string(
        request.get("authoringRouteDigest"),
        "authoringRouteDigest",
    )
    evaluation_route = require_string(
        request.get("evaluationRouteDigest"),
        "evaluationRouteDigest",
    )
    if authoring_route == evaluation_route:
        raise WireError("authoring and evaluation routes must be distinct")
    require_string(request.get("evaluatorRef"), "evaluatorRef")
    require_string(request.get("environmentDigest"), "environmentDigest")
    require_int(request.get("seed"), "seed")
    candidate = require_mapping(request.get("candidate"), "candidate")
    require_string(
        candidate.get("materializedContent"),
        "candidate.materializedContent",
        nonempty=False,
    )
    expected_digest = require_string(
        request.get("evaluationPlanDigest"),
        "evaluationPlanDigest",
    )
    plan = dict(request)
    del plan["evaluationPlanDigest"]
    if expected_digest != sha256_text(canonical_json(plan)):
        raise WireError("evaluation plan digest mismatch")
    return request


def validate_baseline_request(value: Any) -> dict[str, Any]:
    request = require_mapping(value, "request")
    if request.get("operation") != "baseline":
        raise WireError("unsupported baseline operation")
    run = require_mapping(request.get("run"), "run")
    dataset = require_mapping(request.get("dataset"), "dataset")
    run_id = require_string(run.get("id"), "run.id")
    if RUN_ID.fullmatch(run_id) is None:
        raise WireError("run id is invalid")
    state = require_mapping(run.get("state"), "run.state")
    if state.get("_tag") != "dataset-ready":
        raise WireError("baseline requires a dataset-ready run")
    target = require_mapping(run.get("target"), "run.target")
    target_digest = require_string(
        target.get("baselineDigest"),
        "run.target.baselineDigest",
    )
    if (
        state.get("datasetId") != dataset.get("id")
        or state.get("datasetDigest") != dataset.get("digest")
        or run.get("datasetId") != dataset.get("id")
        or run.get("datasetDigest") != dataset.get("digest")
        or dataset.get("targetDigest") != target_digest
        or dataset.get("holdoutSealed") is not True
    ):
        raise WireError("sealed baseline dataset is not bound to the run")
    split_digests = require_mapping(dataset.get("splitDigests"), "splitDigests")
    for split in SPLITS:
        require_string(split_digests.get(split), f"splitDigests.{split}")
    cases = _require_array(dataset.get("cases"), "dataset.cases", nonempty=True)
    observed_splits: set[str] = set()
    case_ids: set[str] = set()
    for index, raw_case in enumerate(cases):
        case = require_mapping(raw_case, f"dataset.cases[{index}]")
        case_id = require_string(case.get("id"), f"dataset.cases[{index}].id")
        split = require_string(case.get("split"), f"dataset.cases[{index}].split")
        if split not in SPLITS or case_id in case_ids:
            raise WireError("dataset cases must have unique ids and valid splits")
        require_int(
            case.get("timeoutMilliseconds"),
            f"dataset.cases[{index}].timeoutMilliseconds",
            minimum=1,
        )
        require_number(
            case.get("maximumCostUsd"),
            f"dataset.cases[{index}].maximumCostUsd",
            minimum=0,
        )
        observed_splits.add(split)
        case_ids.add(case_id)
    if observed_splits != set(SPLITS):
        raise WireError("baseline dataset must contain every split")
    _validate_metric_definitions(request)
    if request.get("baselineSnapshotId") != run.get("baselineSnapshotId"):
        raise WireError("baseline Snapshot is not bound to the run")
    require_string(request.get("baselineSnapshotId"), "baselineSnapshotId")
    authoring_route = require_string(
        request.get("authoringRouteDigest"),
        "authoringRouteDigest",
    )
    evaluation_route = require_string(
        request.get("evaluationRouteDigest"),
        "evaluationRouteDigest",
    )
    if authoring_route == evaluation_route:
        raise WireError("authoring and evaluation routes must be distinct")
    require_string(request.get("evaluatorRef"), "evaluatorRef")
    require_string(request.get("environmentDigest"), "environmentDigest")
    require_int(request.get("seed"), "seed")
    require_number(
        request.get("targetFootprintBytes"),
        "targetFootprintBytes",
        minimum=0,
    )
    expected_digest = require_string(
        request.get("evaluationPlanDigest"),
        "evaluationPlanDigest",
    )
    plan = dict(request)
    del plan["evaluationPlanDigest"]
    if expected_digest != sha256_text(canonical_json(plan)):
        raise WireError("baseline evaluation plan digest mismatch")
    return request


def _executor_configuration() -> tuple[str, str]:
    endpoint = os.getenv("ELLIOTT_EVALUATION_EXECUTOR_ENDPOINT", "")
    token = os.getenv("ELLIOTT_EVALUATION_EXECUTOR_TOKEN", "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise WireError("evaluation executor must be an HTTP loopback endpoint")
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise WireError("evaluation executor endpoint is invalid")
    if not token:
        raise WireError("evaluation executor token is required")
    return endpoint.rstrip("/"), token


def _validate_case_result(
    value: Any,
    evaluation_case: dict[str, Any],
    snapshot_id: str,
    metrics: list[Any],
) -> dict[str, Any]:
    result = require_mapping(value, "case result")
    if (
        result.get("caseId") != evaluation_case.get("id")
        or result.get("split") != evaluation_case.get("split")
        or result.get("snapshotId") != snapshot_id
    ):
        raise WireError("case executor did not attest the requested bindings")
    metric_values = require_mapping(result.get("metricValues"), "metricValues")
    for raw_metric in metrics:
        metric = require_mapping(raw_metric, "metric")
        name = require_string(metric.get("name"), "metric.name")
        require_number(metric_values.get(name), f"metricValues.{name}")
    cost = require_number(result.get("costUsd"), "costUsd", minimum=0)
    if cost > require_number(evaluation_case.get("maximumCostUsd"), "case budget"):
        raise WireError("case executor exceeded its cost budget")
    require_int(result.get("latencyMilliseconds"), "latencyMilliseconds", minimum=0)
    _require_boolean(result.get("passed"), "passed")
    error_tag = result.get("errorTag")
    if error_tag is not None:
        require_string(error_tag, "errorTag")
    require_string(result.get("trajectoryDigest"), "trajectoryDigest")
    return result


def _fixture_case_result(
    request: dict[str, Any],
    evaluation_case: dict[str, Any],
    snapshot_id: str,
) -> dict[str, Any]:
    input_value = require_mapping(evaluation_case.get("input"), "case.input")
    scores = require_mapping(input_value.get("fixtureScores"), "fixtureScores")
    score_key = "candidate" if (
        request.get("candidateSnapshotId") == snapshot_id
    ) else "baseline"
    score = require_number(scores.get(score_key), f"fixtureScores.{score_key}")
    metrics = _require_array(request.get("metrics"), "metrics", nonempty=True)
    return {
        "caseId": evaluation_case["id"],
        "split": evaluation_case["split"],
        "snapshotId": snapshot_id,
        "metricValues": {
            require_string(
                require_mapping(metric, "metric").get("name"),
                "metric.name",
            ): score
            for metric in metrics
        },
        "costUsd": 0,
        "latencyMilliseconds": 1,
        "passed": True,
        "trajectoryDigest": sha256_text(
            canonical_json(
                {
                    "caseId": evaluation_case["id"],
                    "snapshotId": snapshot_id,
                    "seed": request["seed"],
                }
            )
        ),
    }


def _execute_case(
    request: dict[str, Any],
    evaluation_case: dict[str, Any],
    snapshot_id: str,
    seed: int,
) -> dict[str, Any]:
    if os.getenv("ELLIOTT_COMPANION_FIXTURE") == "1":
        raw = _fixture_case_result(request, evaluation_case, snapshot_id)
    else:
        endpoint, token = _executor_configuration()
        operation = {
            "operation": "evaluateCase",
            "snapshotId": snapshot_id,
            "evaluationCase": evaluation_case,
            "evaluatorRef": request["evaluatorRef"],
            "evaluationRouteDigest": request["evaluationRouteDigest"],
            "environmentDigest": request["environmentDigest"],
            "seed": seed,
        }
        payload = canonical_json(operation).encode("utf-8")
        outbound = urllib.request.Request(
            endpoint + "/v1/evaluation/case",
            data=payload,
            method="POST",
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(
                outbound,
                timeout=evaluation_case["timeoutMilliseconds"] / 1000,
            ) as response:
                encoded = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.URLError as error:
            raise WireError(f"evaluation executor failed: {error}") from error
        if len(encoded) > MAX_RESPONSE_BYTES:
            raise WireError("evaluation executor result exceeds the size limit")
        raw = json.loads(encoded)
    return _validate_case_result(
        raw,
        evaluation_case,
        snapshot_id,
        _require_array(request.get("metrics"), "metrics", nonempty=True),
    )


def _average_metric(results: list[dict[str, Any]], metric: str, split: str) -> float:
    values = [
        require_number(
            require_mapping(result.get("metricValues"), "metricValues").get(metric),
            f"metricValues.{metric}",
        )
        for result in results
        if result.get("split") == split
    ]
    if not values:
        raise WireError(f"metric {metric!r} has no {split} samples")
    return sum(values) / len(values)


def baseline(value: dict[str, Any]) -> dict[str, Any]:
    request = validate_baseline_request(value)
    cases = [
        require_mapping(raw_case, "dataset case")
        for raw_case in _require_array(request["dataset"]["cases"], "cases")
        if require_mapping(raw_case, "dataset case").get("split")
        in {"validation", "holdout"}
    ]
    seed = require_int(request.get("seed"), "seed")
    case_results = [
        _execute_case(
            request,
            evaluation_case,
            request["baselineSnapshotId"],
            seed + index,
        )
        for index, evaluation_case in enumerate(cases)
    ]
    metrics = [
        {
            "metric": require_string(
                require_mapping(raw_metric, "metric").get("name"),
                "metric.name",
            ),
            "split": split,
            "value": _average_metric(
                case_results,
                require_string(
                    require_mapping(raw_metric, "metric").get("name"),
                    "metric.name",
                ),
                split,
            ),
            "sampleCount": sum(
                result.get("split") == split for result in case_results
            ),
        }
        for raw_metric in _require_array(
            request.get("metrics"),
            "metrics",
            nonempty=True,
        )
        for split in ("validation", "holdout")
    ]
    total_cost = sum(
        require_number(result.get("costUsd"), "costUsd")
        for result in case_results
    )
    total_latency = sum(
        require_int(result.get("latencyMilliseconds"), "latencyMilliseconds")
        for result in case_results
    )
    trajectories = [
        require_string(result.get("trajectoryDigest"), "trajectoryDigest")
        for result in case_results
    ]
    return {
        "id": f"evb_{uuid.uuid4().hex}",
        "runId": request["run"]["id"],
        "targetDigest": request["run"]["target"]["baselineDigest"],
        "evaluatorRef": request["evaluatorRef"],
        "authoringRouteDigest": request["authoringRouteDigest"],
        "evaluationRouteDigest": request["evaluationRouteDigest"],
        "baselineSnapshotId": request["baselineSnapshotId"],
        "datasetDigest": request["dataset"]["digest"],
        "validationDigest": request["dataset"]["splitDigests"]["validation"],
        "holdoutDigest": request["dataset"]["splitDigests"]["holdout"],
        "evaluationPlanDigest": request["evaluationPlanDigest"],
        "environmentDigest": request["environmentDigest"],
        "seed": request["seed"],
        "caseResults": case_results,
        "metrics": metrics,
        "footprints": [
            {
                "category": "prompt",
                "metric": "target-bytes",
                "value": request["targetFootprintBytes"],
            },
            {
                "category": "inference",
                "metric": "cost-usd",
                "value": total_cost,
            },
            {
                "category": "runtime",
                "metric": "latency-milliseconds",
                "value": total_latency,
            },
        ],
        "trajectoryDigests": trajectories,
        "totalCostUsd": total_cost,
        "totalLatencyMilliseconds": total_latency,
        "createdAt": utc_now(),
    }


def _fitness(
    request: dict[str, Any],
    baseline: list[dict[str, Any]],
    candidate: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    results: list[dict[str, Any]] = []
    all_passed = True
    for raw_metric in _require_array(request.get("metrics"), "metrics", nonempty=True):
        metric = require_mapping(raw_metric, "metric")
        name = require_string(metric.get("name"), "metric.name")
        direction = metric.get("direction")
        floor = require_number(metric.get("regressionFloor"), "regressionFloor")
        for split in SPLITS:
            baseline_value = _average_metric(baseline, name, split)
            candidate_value = _average_metric(candidate, name, split)
            delta = candidate_value - baseline_value
            directional_delta = delta if direction == "maximize" else -delta
            passed = directional_delta >= floor
            all_passed = all_passed and passed
            results.append(
                {
                    "metric": name,
                    "split": split,
                    "baseline": baseline_value,
                    "candidate": candidate_value,
                    "delta": delta,
                    "sampleCount": sum(
                        result.get("split") == split for result in candidate
                    ),
                    "passed": passed,
                }
            )
    return results, all_passed


def _random_sequence(seed: int):
    state = seed & 0xFFFFFFFF
    while True:
        state = (state * LCG_MULTIPLIER + LCG_INCREMENT) & 0xFFFFFFFF
        yield state / LCG_MODULUS


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.floor(probability * len(ordered))))
    return ordered[index]


def _comparison(
    request: dict[str, Any],
    baseline: list[dict[str, Any]],
    candidate: list[dict[str, Any]],
) -> dict[str, Any]:
    primary = require_mapping(
        _require_array(request.get("metrics"), "metrics", nonempty=True)[0],
        "primary metric",
    )
    name = require_string(primary.get("name"), "primary metric name")
    direction = primary.get("direction")
    baseline_samples = [
        require_number(
            require_mapping(result.get("metricValues"), "metricValues").get(name),
            name,
        )
        for result in baseline
        if result.get("split") == "holdout"
    ]
    candidate_samples = [
        require_number(
            require_mapping(result.get("metricValues"), "metricValues").get(name),
            name,
        )
        for result in candidate
        if result.get("split") == "holdout"
    ]
    if direction == "minimize":
        baseline_samples = [-value for value in baseline_samples]
        candidate_samples = [-value for value in candidate_samples]
    if not baseline_samples or len(baseline_samples) != len(candidate_samples):
        raise WireError("paired holdout samples are required")
    deltas = [
        candidate_value - baseline_samples[index]
        for index, candidate_value in enumerate(candidate_samples)
    ]
    random = _random_sequence(require_int(request.get("seed"), "seed"))
    iterations = require_int(
        request.get("bootstrapIterations"),
        "bootstrapIterations",
        minimum=1,
    )
    samples = []
    for _ in range(iterations):
        resample = [
            deltas[math.floor(next(random) * len(deltas))]
            for _ in range(len(deltas))
        ]
        samples.append(sum(resample) / len(resample))
    confidence = require_number(request.get("confidenceLevel"), "confidenceLevel")
    comparisons = require_int(
        request.get("multipleComparisonCount"),
        "multipleComparisonCount",
        minimum=1,
    )
    adjusted_alpha = (1 - confidence) / comparisons
    floor = require_number(primary.get("regressionFloor"), "regressionFloor")
    return {
        "method": "paired-bootstrap",
        "effectSize": sum(deltas) / len(deltas),
        "confidenceLevel": confidence,
        "confidenceIntervalLow": _quantile(samples, adjusted_alpha / 2),
        "confidenceIntervalHigh": _quantile(samples, 1 - adjusted_alpha / 2),
        "pValue": sum(sample <= 0 for sample in samples) / len(samples),
        "sampleCount": len(deltas),
        "multipleComparisonCorrection": (
            "bonferroni" if comparisons > 1 else "none"
        ),
        "passed": _quantile(samples, adjusted_alpha / 2) >= floor,
    }


def _not_applicable(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        "benchmarkRef": gate["benchmarkRef"],
        "scope": "candidate",
        "baselineScore": 0,
        "candidateScore": 0,
        "maximumRegressionRatio": 0,
        "costUsd": 0,
        "latencyMilliseconds": 0,
        "reportDigest": "sha256:not-applicable",
        "status": "not-applicable",
        "reason": gate["notApplicableReason"],
        "passed": True,
    }


def _skipped(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        "benchmarkRef": gate["benchmarkRef"],
        "scope": "candidate",
        "baselineScore": 0,
        "candidateScore": 0,
        "maximumRegressionRatio": 0,
        "costUsd": 0,
        "latencyMilliseconds": 0,
        "reportDigest": "sha256:skipped",
        "status": "skipped",
        "reason": "a preceding required gate failed",
        "passed": False,
    }


def _benchmarks(request: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    blocked = False
    for raw_gate in _require_array(
        request.get("benchmarkGates"),
        "benchmarkGates",
        nonempty=True,
    ):
        gate = require_mapping(raw_gate, "benchmark gate")
        if gate.get("applicable") is not True:
            results.append(_not_applicable(gate))
            continue
        if blocked:
            results.append(_skipped(gate))
            continue
        operation = {
            "operation": gate["operation"],
            "run": request["run"],
            "candidate": request["candidate"],
            "benchmarkRef": gate["benchmarkRef"],
            "baselineSnapshotId": request["baselineSnapshotId"],
            "candidateSnapshotId": request["candidateSnapshotId"],
            "environmentDigest": request["environmentDigest"],
            "seed": request["seed"],
            "timeoutMilliseconds": request["run"]["budgets"][
                "maximumDurationMilliseconds"
            ],
            "maximumCostUsd": request["run"]["budgets"]["maximumCostUsd"],
        }
        result = run_benchmark(operation)
        results.append(result)
        blocked = result.get("passed") is not True
    return results


def _regression_ratio(baseline: float, candidate: float) -> float:
    if baseline == 0:
        return 0 if candidate == 0 else MAXIMUM_FINITE_RATIO
    return (candidate - baseline) / baseline


def _footprints(
    request: dict[str, Any],
    baseline_cases: list[dict[str, Any]],
    candidate_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidate = require_mapping(request.get("candidate"), "candidate")
    candidate_content = require_string(
        candidate.get("materializedContent"),
        "candidate.materializedContent",
        nonempty=False,
    )
    measurements = {
        "prompt": len(candidate_content.encode("utf-8")),
        "inference": sum(
            require_number(result.get("costUsd"), "costUsd")
            for result in candidate_cases
        ),
        "runtime": sum(
            require_int(result.get("latencyMilliseconds"), "latencyMilliseconds")
            for result in candidate_cases
        ),
    }
    observed_baselines = {
        "inference": sum(
            require_number(result.get("costUsd"), "costUsd")
            for result in baseline_cases
        ),
        "runtime": sum(
            require_int(result.get("latencyMilliseconds"), "latencyMilliseconds")
            for result in baseline_cases
        ),
    }
    results = []
    for raw_limit in _require_array(request.get("footprintLimits"), "limits"):
        limit = require_mapping(raw_limit, "footprint limit")
        category = require_string(limit.get("category"), "category")
        baseline = (
            require_number(limit.get("baseline"), "baseline")
            if category == "prompt"
            else observed_baselines[category]
        )
        candidate_value = measurements[category]
        ratio = _regression_ratio(baseline, candidate_value)
        maximum = require_number(
            limit.get("maximumRegressionRatio"),
            "maximumRegressionRatio",
        )
        passed = ratio <= maximum
        results.append(
            {
                "category": category,
                "metric": limit["metric"],
                "baseline": baseline,
                "candidate": candidate_value,
                "maximumRegressionRatio": maximum,
                "regressionRatio": ratio,
                "status": "passed" if passed else "failed",
                "passed": passed,
            }
        )
    return results


def compare(value: dict[str, Any]) -> dict[str, Any]:
    request = validate_evaluation_request(value)
    cases = [
        require_mapping(raw_case, "dataset case")
        for raw_case in _require_array(request["dataset"]["cases"], "cases")
    ]
    seed = require_int(request.get("seed"), "seed")
    baseline_cases = [
        _execute_case(
            request,
            evaluation_case,
            request["baselineSnapshotId"],
            seed + index,
        )
        for index, evaluation_case in enumerate(cases)
    ]
    candidate_cases = [
        _execute_case(
            request,
            evaluation_case,
            request["candidateSnapshotId"],
            seed + index,
        )
        for index, evaluation_case in enumerate(cases)
    ]
    metrics, fitness_passed = _fitness(request, baseline_cases, candidate_cases)
    comparison = _comparison(request, baseline_cases, candidate_cases)
    benchmarks = _benchmarks(request)
    footprints = _footprints(request, baseline_cases, candidate_cases)
    all_cases = [*baseline_cases, *candidate_cases]
    passed = (
        fitness_passed
        and comparison["passed"]
        and all(result["passed"] for result in benchmarks)
        and all(result["passed"] for result in footprints)
    )
    return {
        "id": f"eve_{uuid.uuid4().hex}",
        "runId": request["run"]["id"],
        "candidateId": request["candidate"]["id"],
        "evaluatorRef": request["evaluatorRef"],
        "authoringRouteDigest": request["authoringRouteDigest"],
        "evaluationRouteDigest": request["evaluationRouteDigest"],
        "holdoutDigest": request["dataset"]["splitDigests"]["holdout"],
        "baselineSnapshotId": request["baselineSnapshotId"],
        "candidateSnapshotId": request["candidateSnapshotId"],
        "datasetDigest": request["dataset"]["digest"],
        "evaluationPlanDigest": request["evaluationPlanDigest"],
        "environmentDigest": request["environmentDigest"],
        "seed": request["seed"],
        "baselineCases": baseline_cases,
        "candidateCases": candidate_cases,
        "metrics": metrics,
        "comparison": comparison,
        "benchmarks": benchmarks,
        "footprints": footprints,
        "passed": passed,
        "totalCostUsd": sum(
            require_number(result.get("costUsd"), "costUsd") for result in all_cases
        ),
        "totalLatencyMilliseconds": sum(
            require_int(result.get("latencyMilliseconds"), "latencyMilliseconds")
            for result in all_cases
        ),
        "createdAt": utc_now(),
    }
