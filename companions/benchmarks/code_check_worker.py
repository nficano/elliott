from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from elliott_companion.wire import (
    MAX_RESPONSE_BYTES,
    RUN_ID,
    WireError,
    canonical_json,
    require_mapping,
    require_string,
    sha256_text,
    validate_code_sandbox,
)

REQUIRED_CONSTRAINTS = frozenset(
    {
        "code-focused-test",
        "code-full-check",
        "code-frozen-surface",
    }
)


def validate_code_check_request(value: Any) -> dict[str, Any]:
    request = require_mapping(value, "request")
    if request.get("operation") != "checkCandidate":
        raise WireError("unsupported code-check operation")
    run = require_mapping(request.get("run"), "run")
    run_id = require_string(run.get("id"), "run.id")
    if RUN_ID.fullmatch(run_id) is None:
        raise WireError("run.id is invalid")
    target = require_mapping(run.get("target"), "run.target")
    if target.get("targetClass") != "code":
        raise WireError("code checker accepts only code targets")
    baseline_digest = require_string(
        target.get("baselineDigest"),
        "run.target.baselineDigest",
    )
    candidate = require_mapping(request.get("candidate"), "candidate")
    candidate_id = require_string(candidate.get("id"), "candidate.id")
    candidate_digest = require_string(
        candidate.get("candidateDigest"),
        "candidate.candidateDigest",
    )
    materialized = require_string(
        candidate.get("materializedContent"),
        "candidate.materializedContent",
        nonempty=False,
    )
    if (
        candidate.get("runId") != run_id
        or candidate.get("targetDigest") != baseline_digest
        or candidate_digest != sha256_text(materialized)
    ):
        raise WireError("candidate does not match the run or materialized digest")
    sandbox = validate_code_sandbox(request.get("codeSandbox"))
    try:
        files = require_mapping(json.loads(materialized).get("files"), "candidate files")
    except (AttributeError, json.JSONDecodeError) as error:
        raise WireError("candidate materializedContent is invalid") from error
    target_files = sandbox["targetFiles"]
    if set(files) != set(target_files) or not all(
        isinstance(content, str) for content in files.values()
    ):
        raise WireError("candidate content must contain exactly the target files")
    return request


def _executor_configuration() -> tuple[str, str]:
    endpoint = os.getenv("ELLIOTT_CODE_CHECK_EXECUTOR_ENDPOINT", "")
    token = os.getenv("ELLIOTT_CODE_CHECK_EXECUTOR_TOKEN", "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise WireError("code-check executor must be an HTTP loopback endpoint")
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise WireError("code-check executor endpoint is invalid")
    if not token:
        raise WireError("code-check executor token is required")
    return endpoint.rstrip("/"), token


def _fixture_report(request: dict[str, Any]) -> dict[str, Any]:
    candidate = request["candidate"]
    return {
        "runId": request["run"]["id"],
        "candidateId": candidate["id"],
        "candidateDigest": candidate["candidateDigest"],
        "constraints": [
            {
                "constraint": name,
                "passed": True,
                "detail": "isolated fixture check passed",
                "evidenceDigests": [sha256_text(f"fixture:{name}")],
            }
            for name in sorted(REQUIRED_CONSTRAINTS)
        ],
    }


def _execute(request: dict[str, Any]) -> Any:
    endpoint, token = _executor_configuration()
    outbound = urllib.request.Request(
        endpoint + "/v1/candidate/check",
        data=canonical_json(request).encode("utf-8"),
        method="POST",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(
            outbound,
            timeout=request["codeSandbox"]["timeoutMilliseconds"] / 1000,
        ) as response:
            encoded = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.URLError as error:
        raise WireError(f"code-check executor failed: {error}") from error
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise WireError("code-check executor result exceeds the size limit")
    return json.loads(encoded)


def _validate_report(value: Any, request: dict[str, Any]) -> dict[str, Any]:
    report = require_mapping(value, "code-check report")
    candidate = request["candidate"]
    if (
        report.get("runId") != request["run"]["id"]
        or report.get("candidateId") != candidate["id"]
        or report.get("candidateDigest") != candidate["candidateDigest"]
    ):
        raise WireError("code-check report does not attest the request bindings")
    constraints = report.get("constraints")
    if not isinstance(constraints, list):
        raise WireError("code-check report constraints must be an array")
    names: set[str] = set()
    for index, raw_constraint in enumerate(constraints):
        constraint = require_mapping(raw_constraint, f"constraints[{index}]")
        name = require_string(
            constraint.get("constraint"),
            f"constraints[{index}].constraint",
        )
        if (
            name in names
            or not isinstance(constraint.get("passed"), bool)
            or not isinstance(constraint.get("evidenceDigests"), list)
        ):
            raise WireError("code-check constraints are malformed or duplicated")
        require_string(constraint.get("detail"), f"constraints[{index}].detail")
        names.add(name)
    if names != REQUIRED_CONSTRAINTS:
        raise WireError("code-check report omitted a required constraint")
    return report


def check_candidate(value: Any) -> dict[str, Any]:
    request = validate_code_check_request(value)
    raw = (
        _fixture_report(request)
        if os.getenv("ELLIOTT_COMPANION_FIXTURE") == "1"
        else _execute(request)
    )
    return _validate_report(raw, request)
