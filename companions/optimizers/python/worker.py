"""Minimal Python-library adapter for the TypeScript companion supervisor."""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_ERROR_CHARACTERS = 4_096


class WireError(ValueError):
    """A library adapter operation violated its validated contract."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def make_patch(before: str, after: str, path: str) -> str:
    return "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def _require_mapping(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise WireError(f"{name} must be an object")
    return value


WorkerFn = Callable[[dict[str, Any]], dict[str, Any]]


def _write_atomic(path: Path, value: dict[str, Any]) -> None:
    encoded = canonical_json(value).encode("utf-8")
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ValueError("worker response exceeds the size limit")
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(encoded)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def run_worker(worker: WorkerFn) -> int:
    if len(sys.argv) != 3:
        return 64
    request_path, result_path = sys.argv[1:]
    result = Path(result_path)
    try:
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        output = worker(_require_mapping(request, "request"))
        _write_atomic(result, _require_mapping(output, "worker result"))
        return 0
    except Exception as error:  # noqa: BLE001 - serialize the process boundary.
        _write_atomic(
            result,
            {
                "error": {
                    "type": type(error).__name__,
                    "message": str(error)[:MAX_ERROR_CHARACTERS],
                    "traceDigest": hashlib.sha256(
                        traceback.format_exc().encode("utf-8")
                    ).hexdigest(),
                }
            },
        )
        return 1
