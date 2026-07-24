from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def _request(url: str, value: dict[str, Any] | None = None) -> Any:
    data = None if value is None else json.dumps(value).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="GET" if data is None else "POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())

def _baseline_payload(comparison: dict[str, Any]) -> dict[str, Any]:
    payload = json.loads(json.dumps(comparison))
    for name in (
        "candidate",
        "candidateSnapshotId",
        "benchmarkGates",
        "footprintLimits",
        "confidenceLevel",
        "bootstrapIterations",
        "multipleComparisonCount",
        "requiredConstraints",
    ):
        payload.pop(name)
    payload["operation"] = "baseline"
    payload["run"]["state"] = {
        "_tag": "dataset-ready",
        "datasetId": payload["dataset"]["id"],
        "datasetDigest": payload["dataset"]["digest"],
    }
    payload["run"].pop("optimizationSeed", None)
    payload["targetFootprintBytes"] = 128
    payload.pop("evaluationPlanDigest")
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    payload["evaluationPlanDigest"] = (
        f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument(
        "--kind",
        choices=["optimizer", "benchmark", "evaluator", "baseline"],
        required=True,
    )
    args = parser.parse_args()
    for _ in range(100):
        try:
            health = _request(args.endpoint.rstrip("/") + "/healthz")
            if health == {"status": "ok"}:
                break
        except urllib.error.URLError:
            time.sleep(0.05)
    else:
        raise SystemExit("companion did not become healthy")
    payload = json.loads(args.request.read_text(encoding="utf-8"))
    if args.kind == "baseline":
        payload = _baseline_payload(payload)
    result = _request(args.endpoint.rstrip("/") + args.path, payload)
    if args.kind == "optimizer":
        if result.get("runId") != payload["run"]["id"]:
            raise SystemExit("optimizer smoke result runId mismatch")
        if result.get("paused") is not False or len(result.get("candidates", [])) != 1:
            raise SystemExit(
                "optimizer smoke result did not contain one completed candidate"
            )
        candidate = result["candidates"][0]
        if candidate.get("runId") != payload["run"]["id"]:
            raise SystemExit("candidate runId mismatch")
        if not str(candidate.get("candidateDigest", "")).startswith("sha256:"):
            raise SystemExit("candidate digest is missing")
    elif args.kind == "benchmark":
        if result.get("benchmarkRef") != payload["benchmarkRef"]:
            raise SystemExit("benchmark smoke result reference mismatch")
        if result.get("status") != "passed" or result.get("passed") is not True:
            raise SystemExit("benchmark smoke result did not pass")
        if not str(result.get("reportDigest", "")).startswith("sha256:"):
            raise SystemExit("benchmark report digest is missing")
    elif args.kind == "evaluator":
        if result.get("runId") != payload["run"]["id"]:
            raise SystemExit("evaluation smoke result runId mismatch")
        if result.get("candidateId") != payload["candidate"]["id"]:
            raise SystemExit("evaluation smoke result candidateId mismatch")
        if result.get("passed") is not True:
            raise SystemExit("evaluation smoke result did not pass")
        if len(result.get("benchmarks", [])) != len(payload["benchmarkGates"]):
            raise SystemExit("evaluation smoke result omitted benchmark gates")
    else:
        if result.get("runId") != payload["run"]["id"]:
            raise SystemExit("baseline smoke result runId mismatch")
        if {
            item.get("split") for item in result.get("caseResults", [])
        } != {"validation", "holdout"}:
            raise SystemExit("baseline smoke did not isolate evaluation splits")
        if len(result.get("trajectoryDigests", [])) != len(
            result.get("caseResults", [])
        ):
            raise SystemExit("baseline smoke result omitted trajectories")
        if {
            item.get("category") for item in result.get("footprints", [])
        } != {"prompt", "inference", "runtime"}:
            raise SystemExit("baseline smoke result omitted footprints")
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
