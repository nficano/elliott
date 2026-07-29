from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "companions" / "images.lock.json"
IMAGE_PATTERN = re.compile(r"^\s+image:\s+(\S+)\s*$", re.MULTILINE)
SOURCE_FILES = {
    "optimizer-runtime": [
        "companions/runtime/http.ts",
        "companions/runtime/smoke.ts",
        "companions/runtime/wire.ts",
        "companions/optimizers/contract.ts",
        "companions/optimizers/server.ts",
        "companions/optimizers/jobs/controller.ts",
        "companions/optimizers/jobs/support.ts",
        "companions/optimizers/python/worker.py",
        *sorted(
            str(path.relative_to(ROOT))
            for path in (ROOT / "src").rglob("*.ts")
        ),
    ],
    "evaluator-dspy": [
        "companions/optimizers/dspy/Dockerfile",
        "companions/optimizers/dspy/pyproject.toml",
        "companions/optimizers/dspy/uv.lock",
        "companions/optimizers/dspy/worker.py",
        "package.json",
        "bun.lock",
    ],
    "evaluator-darwinian": [
        "companions/optimizers/darwinian/Dockerfile",
        "companions/optimizers/darwinian/problem.py",
        "companions/optimizers/darwinian/worker.py",
        "package.json",
        "bun.lock",
    ],
    "evaluator-agent-benchmarks": [
        "companions/evaluators/agent-benchmarks/Dockerfile",
        "companions/evaluators/agent-benchmarks/benchmark/config.ts",
        "companions/evaluators/agent-benchmarks/benchmark/driver.ts",
        "companions/evaluators/agent-benchmarks/benchmark/drivers.json",
        "companions/evaluators/agent-benchmarks/benchmark/index.ts",
        "companions/evaluators/agent-benchmarks/benchmark/result.ts",
        "companions/evaluators/agent-benchmarks/benchmark/snapshot-executor.ts",
        "companions/evaluators/agent-benchmarks/candidate/check.ts",
        "companions/evaluators/agent-benchmarks/evaluation/baseline.ts",
        "companions/evaluators/agent-benchmarks/evaluation/benchmarks.ts",
        "companions/evaluators/agent-benchmarks/evaluation/compare.ts",
        "companions/evaluators/agent-benchmarks/evaluation/executor.ts",
        "companions/evaluators/agent-benchmarks/evaluation/index.ts",
        "companions/evaluators/agent-benchmarks/evaluation/metrics.ts",
        "companions/evaluators/agent-benchmarks/evaluation/validation.ts",
        "companions/evaluators/agent-benchmarks/server.ts",
        "companions/runtime/http.ts",
        "companions/runtime/smoke.ts",
        "companions/runtime/wire.ts",
        "package.json",
        "bun.lock",
        *sorted(
            str(path.relative_to(ROOT))
            for path in (ROOT / "src").rglob("*.ts")
        ),
    ],
}
MANIFESTS = {
    "evaluator-dspy": "skills/evaluator/dspy/manifest.yaml",
    "evaluator-darwinian": "skills/evaluator/darwinian/manifest.yaml",
    "evaluator-agent-benchmarks": "skills/evaluator/agent-benchmarks/manifest.yaml",
}
REQUIRED_BENCHMARKS = {
    "target-syntax",
    "immutable-field-check",
    "permission-and-containment",
    "static-security",
    "focused-contract-tests",
    "elliott-check",
    "tblite-fast",
    "task-specific-subset",
    "task-specific-validation",
    "independent-holdout",
    "tblite-full",
    "yc-bench",
    "terminalbench2",
}


def _digest(paths: list[str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(paths):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update((ROOT / relative).read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _mapping(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SystemExit(f"{name} must be an object")
    return value


def main() -> int:
    lock = _mapping(json.loads(LOCK_PATH.read_text(encoding="utf-8")), "image lock")
    if lock.get("schemaVersion") != 1:
        raise SystemExit("unsupported evolution image lock version")
    build = _mapping(lock.get("build"), "image lock build")
    if build.get("optimizerRuntimeSourceDigest") != _digest(
        SOURCE_FILES["optimizer-runtime"]
    ):
        raise SystemExit("optimizer runtime source changed without rebuilding images")
    images = _mapping(lock.get("images"), "image lock images")
    for name, manifest_path in MANIFESTS.items():
        image = _mapping(images.get(name), f"image {name}")
        if image.get("sourceDigest") != _digest(SOURCE_FILES[name]):
            raise SystemExit(f"{name} source changed without rebuilding its image")
        local_reference = image.get("localReference")
        digest = image.get("ociManifestDigest")
        if (
            not isinstance(local_reference, str)
            or not isinstance(digest, str)
            or not local_reference.endswith(f"@{digest}")
            or re.fullmatch(r"sha256:[a-f0-9]{64}", digest) is None
        ):
            raise SystemExit(f"{name} has an invalid digest lock")
        manifest = (ROOT / manifest_path).read_text(encoding="utf-8")
        match = IMAGE_PATTERN.search(manifest)
        if match is None or match.group(1) != local_reference:
            raise SystemExit(f"{manifest_path} does not match the observed image lock")
        if image.get("fixtureSmokePassed") is not True:
            raise SystemExit(f"{name} has no recorded fixture smoke result")
    drivers = _mapping(
        json.loads(
            (
                ROOT
                / "companions/evaluators/agent-benchmarks/benchmark/drivers.json"
            ).read_text(encoding="utf-8")
        ).get("drivers"),
        "benchmark drivers",
    )
    missing = REQUIRED_BENCHMARKS.difference(drivers)
    if missing:
        raise SystemExit(f"benchmark driver lock is incomplete: {sorted(missing)!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
