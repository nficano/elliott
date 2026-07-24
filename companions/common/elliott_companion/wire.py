from __future__ import annotations

import difflib
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

RUN_ID = re.compile(r"^evr_[a-z0-9][a-z0-9_-]{7,127}$")
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
MAX_REQUEST_BYTES = 32 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_CHECKOUT_FILES = 10_000
MAX_CHECKOUT_FILE_BYTES = 5_000_000
FORBIDDEN_EXECUTABLES = frozenset(
    {
        "bash",
        "cmd",
        "curl",
        "dash",
        "docker",
        "doas",
        "env",
        "fish",
        "git",
        "kubectl",
        "nerdctl",
        "podman",
        "powershell",
        "pwsh",
        "sh",
        "sudo",
        "wget",
        "zsh",
    }
)


class WireError(ValueError):
    """An untrusted request or worker response violated the wire contract."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def require_mapping(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise WireError(f"{name} must be an object")
    return value


def require_string(value: Any, name: str, *, nonempty: bool = True) -> str:
    if not isinstance(value, str) or (nonempty and not value):
        raise WireError(f"{name} must be a non-empty string")
    return value


def require_int(value: Any, name: str, *, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise WireError(f"{name} must be an integer")
    if minimum is not None and value < minimum:
        raise WireError(f"{name} must be at least {minimum}")
    return value


def require_number(value: Any, name: str, *, minimum: float | None = None) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise WireError(f"{name} must be finite")
    result = float(value)
    if minimum is not None and result < minimum:
        raise WireError(f"{name} must be at least {minimum}")
    return result


def validate_optimizer_request(value: Any, *, code: bool) -> dict[str, Any]:
    request = require_mapping(value, "request")
    run = require_mapping(request.get("run"), "run")
    run_id = require_string(run.get("id"), "run.id")
    if RUN_ID.fullmatch(run_id) is None:
        raise WireError("run.id is invalid")
    target = require_mapping(run.get("target"), "run.target")
    target_class = require_string(target.get("targetClass"), "run.target.targetClass")
    permitted = {"code"} if code else {"skill", "tool-description", "prompt-segment"}
    if target_class not in permitted:
        raise WireError(
            f"target class {target_class!r} is not supported by this worker"
        )
    baseline_digest = require_string(
        target.get("baselineDigest"),
        "run.target.baselineDigest",
    )
    engine_kind = require_string(run.get("engineKind"), "run.engineKind")
    permitted_engines = {"darwinian"} if code else {"gepa", "miprov2"}
    if engine_kind not in permitted_engines:
        raise WireError(f"engine kind {engine_kind!r} is not supported by this worker")
    dataset = require_mapping(request.get("dataset"), "dataset")
    allowed_dataset_keys = {
        "id",
        "targetDigest",
        "digest",
        "splitSeed",
        "trainDigest",
        "validationDigest",
        "classification",
        "sources",
        "trainCases",
        "validationCases",
        "holdoutSealed",
    }
    unexpected = set(dataset).difference(allowed_dataset_keys)
    if unexpected:
        raise WireError(f"dataset contains unexpected fields: {sorted(unexpected)!r}")
    if dataset.get("holdoutSealed") is not True:
        raise WireError("dataset must attest that holdout is sealed")
    if dataset.get("targetDigest") != baseline_digest:
        raise WireError("dataset target digest does not match the run target")
    if run.get("datasetId") is not None and run.get("datasetId") != dataset.get("id"):
        raise WireError("dataset id does not match the run")
    if run.get("datasetDigest") is not None and run.get("datasetDigest") != dataset.get(
        "digest"
    ):
        raise WireError("dataset digest does not match the run")
    if "holdoutCases" in canonical_json(dataset):
        raise WireError("optimizer requests may not contain holdout cases")
    train_cases = dataset.get("trainCases")
    validation_cases = dataset.get("validationCases")
    if not isinstance(train_cases, list) or not isinstance(validation_cases, list):
        raise WireError("dataset trainCases and validationCases must be arrays")
    require_string(request.get("baselineContent"), "baselineContent", nonempty=False)
    request_limits = {
        "maximumCandidates": require_int(
            request.get("maximumCandidates"),
            "maximumCandidates",
            minimum=1,
        ),
        "maximumTokens": require_int(
            request.get("maximumTokens"),
            "maximumTokens",
            minimum=1,
        ),
        "maximumCostUsd": require_number(
            request.get("maximumCostUsd"),
            "maximumCostUsd",
            minimum=0.000_000_1,
        ),
        "maximumDurationMilliseconds": require_int(
            request.get("maximumDurationMilliseconds"),
            "maximumDurationMilliseconds",
            minimum=1,
        ),
        "maximumConcurrency": require_int(
            request.get("maximumConcurrency"),
            "maximumConcurrency",
            minimum=1,
        ),
    }
    budgets = require_mapping(run.get("budgets"), "run.budgets")
    for name, requested in request_limits.items():
        budget = require_number(
            budgets.get(name), f"run.budgets.{name}", minimum=0.000_000_1
        )
        if requested > budget:
            raise WireError(f"{name} exceeds the run budget")
    seed = require_int(request.get("seed"), "seed")
    if run.get("optimizationSeed") is not None and run.get("optimizationSeed") != seed:
        raise WireError("optimization seed does not match the run")
    if code:
        validate_code_sandbox(request.get("codeSandbox"))
    elif request.get("codeSandbox") is not None:
        raise WireError("text workers do not accept codeSandbox")
    return request


def _safe_relative_path(value: str) -> bool:
    path = PurePosixPath(value)
    return (
        bool(value)
        and "\x00" not in value
        and not path.is_absolute()
        and ".." not in path.parts
        and value != "."
    )


def validate_code_sandbox(value: Any) -> dict[str, Any]:
    sandbox = require_mapping(value, "codeSandbox")
    checkout_ref = require_string(sandbox.get("checkoutRef"), "codeSandbox.checkoutRef")
    if not checkout_ref.startswith("candidate://") or ".." in checkout_ref:
        raise WireError("checkoutRef must identify a candidate-only checkout")
    for flag in (
        "networkEnabled",
        "repositoryCredentialsMounted",
        "gitRemotePresent",
        "activeTreeWritable",
        "containerRuntimeSocketMounted",
    ):
        if sandbox.get(flag) is not False:
            raise WireError(f"codeSandbox.{flag} must be false")
    files = sandbox.get("checkoutFiles")
    if not isinstance(files, list) or not files or len(files) > MAX_CHECKOUT_FILES:
        raise WireError("checkoutFiles must be a non-empty bounded array")
    paths: set[str] = set()
    for index, raw_file in enumerate(files):
        file = require_mapping(raw_file, f"checkoutFiles[{index}]")
        path = require_string(file.get("path"), f"checkoutFiles[{index}].path")
        content = require_string(
            file.get("content"),
            f"checkoutFiles[{index}].content",
            nonempty=False,
        )
        if not _safe_relative_path(path) or path in paths:
            raise WireError("checkout file paths must be unique and relative")
        if len(content.encode("utf-8")) > MAX_CHECKOUT_FILE_BYTES:
            raise WireError("checkout file is too large")
        if file.get("digest") != sha256_text(content):
            raise WireError("checkout file digest mismatch")
        if not isinstance(file.get("executable"), bool):
            raise WireError("checkout executable flag must be boolean")
        paths.add(path)
    target_files = sandbox.get("targetFiles")
    if not isinstance(target_files, list) or not target_files:
        raise WireError("targetFiles must be non-empty")
    if any(not isinstance(path, str) or path not in paths for path in target_files):
        raise WireError("targetFiles must name files in the sealed checkout")
    commands = sandbox.get("testCommands")
    if not isinstance(commands, list) or not commands:
        raise WireError("testCommands must be non-empty")
    for command in commands:
        if (
            not isinstance(command, list)
            or not command
            or not all(isinstance(arg, str) and arg for arg in command)
        ):
            raise WireError("each test command must be a non-empty argv array")
        executable = PurePosixPath(command[0]).name
        if executable in FORBIDDEN_EXECUTABLES:
            raise WireError(f"test executable {executable!r} is forbidden")
    require_number(sandbox.get("cpuQuota"), "codeSandbox.cpuQuota", minimum=0.000_000_1)
    require_int(sandbox.get("memoryMb"), "codeSandbox.memoryMb", minimum=1)
    require_int(sandbox.get("pids"), "codeSandbox.pids", minimum=1)
    require_int(
        sandbox.get("timeoutMilliseconds"),
        "codeSandbox.timeoutMilliseconds",
        minimum=1,
    )
    return sandbox


def make_patch(before: str, after: str, path: str) -> str:
    return "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def make_candidate(
    request: dict[str, Any],
    materialized_content: str,
    *,
    patch: str,
    trace: dict[str, Any],
    usage: dict[str, int | float],
    parent_candidate_id: str | None = None,
    validation_score: float | None = None,
) -> dict[str, Any]:
    digest = sha256_text(materialized_content)
    run = require_mapping(request["run"], "run")
    candidate: dict[str, Any] = {
        "id": f"evc_{digest.removeprefix('sha256:')[:24]}",
        "runId": run["id"],
        "targetDigest": run["target"]["baselineDigest"],
        "candidateDigest": digest,
        "patch": patch,
        "materializedContent": materialized_content,
        "engineTraceDigest": sha256_text(canonical_json(trace)),
        "usage": {
            "inputTokens": require_int(
                usage.get("inputTokens"), "usage.inputTokens", minimum=0
            ),
            "outputTokens": require_int(
                usage.get("outputTokens"), "usage.outputTokens", minimum=0
            ),
            "costUsd": require_number(usage.get("costUsd"), "usage.costUsd", minimum=0),
            "latencyMilliseconds": require_int(
                usage.get("latencyMilliseconds"),
                "usage.latencyMilliseconds",
                minimum=0,
            ),
        },
        "constraints": [],
        "createdAt": utc_now(),
    }
    if parent_candidate_id is not None:
        candidate["parentCandidateId"] = parent_candidate_id
    if validation_score is not None:
        candidate["validationScore"] = require_number(
            validation_score,
            "validationScore",
        )
    return candidate


def make_engine_result(
    request: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    maximum = min(
        require_int(request["maximumCandidates"], "maximumCandidates", minimum=1), 100
    )
    return {
        "runId": request["run"]["id"],
        "candidates": candidates[:maximum],
        "paused": False,
    }
