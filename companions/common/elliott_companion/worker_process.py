from __future__ import annotations

import importlib
import json
import os
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .wire import MAX_RESPONSE_BYTES, canonical_json


def _load_worker(reference: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    module_name, separator, function_name = reference.partition(":")
    if not separator or not module_name or not function_name:
        raise ValueError("worker reference must have module:function form")
    module = importlib.import_module(module_name)
    worker = getattr(module, function_name)
    if not callable(worker):
        raise TypeError("worker reference is not callable")
    return worker


def _write_atomic(path: Path, value: dict[str, Any]) -> None:
    encoded = canonical_json(value).encode("utf-8")
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ValueError("worker response exceeds the size limit")
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(encoded)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def main() -> int:
    if len(sys.argv) != 4:
        return 64
    worker_reference, request_path, result_path = sys.argv[1:]
    result = Path(result_path)
    try:
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        output = _load_worker(worker_reference)(request)
        if not isinstance(output, dict):
            raise TypeError("worker result must be an object")
        _write_atomic(result, output)
        return 0
    except Exception as error:  # noqa: BLE001 - process boundary serializes all failures.
        _write_atomic(
            result,
            {
                "error": {
                    "type": type(error).__name__,
                    "message": str(error)[:4096],
                    "traceDigest": __import__("hashlib")
                    .sha256(traceback.format_exc().encode("utf-8"))
                    .hexdigest(),
                }
            },
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
