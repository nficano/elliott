from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from elliott_companion.wire import (
    MAX_RESPONSE_BYTES,
    WireError,
    canonical_json,
    require_int,
    require_mapping,
    require_number,
    require_string,
    sha256_text,
)

SUPPORTED_OPERATIONS = {"runSubset", "runFull", "compareBaseline"}
SUPPORTED_SCOPES = {"candidate", "shortlist", "release"}
PASSTHROUGH_ENVIRONMENT = frozenset(
    {
        "ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT",
        "ELLIOTT_BENCHMARK_EXECUTOR_TOKEN",
        "LANG",
        "LC_ALL",
        "PATH",
        "PYTHONPATH",
        "PYTHONUNBUFFERED",
    }
)


def _validate_operation(value: Any) -> dict[str, Any]:
    operation = require_mapping(value, "operation")
    if operation.get("operation") not in SUPPORTED_OPERATIONS:
        raise WireError("unsupported benchmark operation")
    require_mapping(operation.get("run"), "run")
    require_mapping(operation.get("candidate"), "candidate")
    require_string(operation.get("benchmarkRef"), "benchmarkRef")
    require_string(operation.get("baselineSnapshotId"), "baselineSnapshotId")
    require_string(operation.get("candidateSnapshotId"), "candidateSnapshotId")
    require_string(operation.get("environmentDigest"), "environmentDigest")
    require_int(operation.get("seed"), "seed")
    require_int(operation.get("timeoutMilliseconds"), "timeoutMilliseconds", minimum=1)
    require_number(
        operation.get("maximumCostUsd"), "maximumCostUsd", minimum=0.000_000_1
    )
    if operation["run"].get("id") != operation["candidate"].get("runId"):
        raise WireError("candidate is not bound to the benchmark run")
    if operation["run"].get("target", {}).get("baselineDigest") != operation[
        "candidate"
    ].get("targetDigest"):
        raise WireError("candidate target digest does not match the run")
    return operation


def _load_configuration() -> dict[str, Any]:
    raw_path = os.getenv(
        "ELLIOTT_BENCHMARK_DRIVER_CONFIG",
        "/opt/elliott/benchmark-drivers.json",
    )
    path = Path(raw_path)
    if not path.is_absolute() or not path.is_file():
        raise WireError("benchmark driver configuration is unavailable")
    value = json.loads(path.read_text(encoding="utf-8"))
    configuration = require_mapping(value, "benchmark configuration")
    if configuration.get("schemaVersion") != 1:
        raise WireError("unsupported benchmark driver configuration version")
    require_mapping(configuration.get("drivers"), "benchmark drivers")
    return configuration


def _render_argument(argument: str, values: dict[str, str]) -> str:
    rendered = argument
    for name, value in values.items():
        rendered = rendered.replace(f"{{{name}}}", value)
    if "{" in rendered or "}" in rendered:
        raise WireError(f"unresolved benchmark command placeholder in {argument!r}")
    return rendered


def _binding(operation: dict[str, Any]) -> dict[str, Any]:
    return {
        "benchmarkRef": operation["benchmarkRef"],
        "baselineSnapshotId": operation["baselineSnapshotId"],
        "candidateSnapshotId": operation["candidateSnapshotId"],
        "environmentDigest": operation["environmentDigest"],
        "seed": operation["seed"],
    }


def _fixture_result(
    operation: dict[str, Any], driver: dict[str, Any]
) -> dict[str, Any]:
    return {
        "bindings": _binding(operation),
        "baselineScore": 1.0,
        "candidateScore": 1.0,
        "costUsd": 0.0,
        "latencyMilliseconds": 0,
        "evidence": {
            "fixture": True,
            "driverRevision": driver.get("revision"),
        },
    }


def _run_driver(
    operation: dict[str, Any],
    driver: dict[str, Any],
    work: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    request_path = work / "operation.json"
    result_path = work / "result.json"
    request_path.write_text(canonical_json(operation), encoding="utf-8")
    request_path.chmod(0o600)
    argv = driver.get("argv")
    if (
        not isinstance(argv, list)
        or not argv
        or not all(isinstance(argument, str) and argument for argument in argv)
    ):
        raise WireError("benchmark driver argv must be a non-empty string array")
    values = {
        "request": str(request_path),
        "result": str(result_path),
        "work": str(work),
        "benchmarkRef": operation["benchmarkRef"],
        "baselineSnapshotId": operation["baselineSnapshotId"],
        "candidateSnapshotId": operation["candidateSnapshotId"],
        "environmentDigest": operation["environmentDigest"],
        "seed": str(operation["seed"]),
    }
    command = [_render_argument(argument, values) for argument in argv]
    environment = {
        key: value
        for key, value in os.environ.items()
        if key in PASSTHROUGH_ENVIRONMENT
    }
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            cwd=work,
            env=environment,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            shell=False,
            timeout=operation["timeoutMilliseconds"] / 1000,
        )
        elapsed_ms = round((time.monotonic() - started) * 1000)
    except subprocess.TimeoutExpired as error:
        elapsed_ms = round((time.monotonic() - started) * 1000)
        return (
            {
                "bindings": _binding(operation),
                "baselineScore": 0,
                "candidateScore": 0,
                "costUsd": 0,
                "latencyMilliseconds": elapsed_ms,
                "driverFailure": "timeout",
            },
            {
                "exitCode": 124,
                "stdoutDigest": sha256_text(
                    (error.stdout or b"").decode("utf-8", errors="replace")
                ),
                "stderrDigest": sha256_text(
                    (error.stderr or b"").decode("utf-8", errors="replace")
                ),
            },
        )
    process_evidence = {
        "exitCode": completed.returncode,
        "stdoutDigest": f"sha256:{hashlib.sha256(completed.stdout).hexdigest()}",
        "stderrDigest": f"sha256:{hashlib.sha256(completed.stderr).hexdigest()}",
    }
    if completed.returncode != 0 or not result_path.is_file():
        return (
            {
                "bindings": _binding(operation),
                "baselineScore": 0,
                "candidateScore": 0,
                "costUsd": 0,
                "latencyMilliseconds": elapsed_ms,
                "driverFailure": f"exit-{completed.returncode}",
            },
            process_evidence,
        )
    if result_path.stat().st_size > MAX_RESPONSE_BYTES:
        raise WireError("benchmark driver result exceeds the size limit")
    result = require_mapping(
        json.loads(result_path.read_text(encoding="utf-8")),
        "benchmark driver result",
    )
    result.setdefault("latencyMilliseconds", elapsed_ms)
    return result, process_evidence


def _result(
    operation: dict[str, Any],
    driver: dict[str, Any],
    raw: dict[str, Any],
    process_evidence: dict[str, Any],
) -> dict[str, Any]:
    if raw.get("bindings") != _binding(operation):
        raise WireError("benchmark driver did not attest the requested bindings")
    baseline = require_number(raw.get("baselineScore"), "baselineScore")
    candidate = require_number(raw.get("candidateScore"), "candidateScore")
    cost = require_number(raw.get("costUsd"), "costUsd", minimum=0)
    latency = require_int(
        raw.get("latencyMilliseconds"), "latencyMilliseconds", minimum=0
    )
    tolerance = require_number(
        driver.get("maximumRegressionRatio"),
        "maximumRegressionRatio",
        minimum=0,
    )
    scope = driver.get("scope")
    if scope not in SUPPORTED_SCOPES:
        raise WireError("benchmark driver scope is invalid")
    floor = baseline - abs(baseline) * tolerance
    score_passed = candidate >= floor
    failure = raw.get("driverFailure")
    budget_passed = cost <= operation["maximumCostUsd"]
    passed = score_passed and budget_passed and failure is None
    reason_parts = []
    if failure is not None:
        reason_parts.append(f"driver failed: {failure}")
    if not score_passed:
        reason_parts.append(
            f"candidate score {candidate} is below regression floor {floor}"
        )
    if not budget_passed:
        reason_parts.append(
            f"cost {cost} exceeds request ceiling {operation['maximumCostUsd']}"
        )
    evidence = {
        "bindings": _binding(operation),
        "driver": {
            "name": driver.get("name"),
            "source": driver.get("source"),
            "revision": driver.get("revision"),
        },
        "process": process_evidence,
        "reportedEvidence": raw.get("evidence"),
        "scores": {"baseline": baseline, "candidate": candidate},
        "costUsd": cost,
        "latencyMilliseconds": latency,
    }
    return {
        "benchmarkRef": operation["benchmarkRef"],
        "scope": scope,
        "baselineScore": baseline,
        "candidateScore": candidate,
        "maximumRegressionRatio": tolerance,
        "costUsd": cost,
        "latencyMilliseconds": latency,
        "reportDigest": sha256_text(canonical_json(evidence)),
        "status": "passed" if passed else "failed",
        **({"reason": "; ".join(reason_parts)} if reason_parts else {}),
        "passed": passed,
    }


def run_benchmark(value: dict[str, Any]) -> dict[str, Any]:
    operation = _validate_operation(value)
    configuration = _load_configuration()
    drivers = configuration["drivers"]
    raw_driver = drivers.get(operation["benchmarkRef"])
    driver = require_mapping(raw_driver, f"driver {operation['benchmarkRef']}")
    with tempfile.TemporaryDirectory(prefix="elliott-benchmark-") as raw_work:
        work = Path(raw_work)
        if os.getenv("ELLIOTT_COMPANION_FIXTURE") == "1":
            raw = _fixture_result(operation, driver)
            process_evidence = {"fixture": True}
        else:
            raw, process_evidence = _run_driver(operation, driver, work)
        return _result(operation, driver, raw, process_evidence)
