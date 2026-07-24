from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    endpoint = os.getenv("ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT", "")
    token = os.getenv("ELLIOTT_BENCHMARK_EXECUTOR_TOKEN", "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise SystemExit("benchmark executor must be an HTTP loopback endpoint")
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise SystemExit("benchmark executor endpoint is invalid")
    if not token:
        raise SystemExit("benchmark executor token is required")
    operation = json.loads(args.request.read_text(encoding="utf-8"))
    payload = json.dumps(
        {
            "operation": operation,
            "driverSource": args.source,
            "driverRevision": args.revision,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/v1/benchmark",
        data=payload,
        method="POST",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=operation["timeoutMilliseconds"] / 1000,
        ) as response:
            result = response.read(32 * 1024 * 1024 + 1)
    except urllib.error.URLError as error:
        raise SystemExit(f"benchmark executor failed: {error}") from error
    if len(result) > 32 * 1024 * 1024:
        raise SystemExit("benchmark executor result is too large")
    value = json.loads(result)
    args.result.write_text(
        json.dumps(value, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    args.result.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
