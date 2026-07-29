from __future__ import annotations

import os
from typing import Any

from companions.optimizers.python.worker import (
    canonical_json,
    make_patch,
    run_worker,
)

UPSTREAM_REVISION = "7f12365d2059c47e29068a5a6f498a293148d2a9"


def _materialized(files: dict[str, str]) -> str:
    return canonical_json({"files": files})


def _combined_patch(
    baseline_files: dict[str, str],
    candidate_files: dict[str, str],
) -> str:
    return "".join(
        make_patch(baseline_files[path], candidate_files[path], path)
        for path in sorted(candidate_files)
        if baseline_files[path] != candidate_files[path]
    )


def _fixture(request: dict[str, Any]) -> list[dict[str, Any]]:
    sandbox = request["codeSandbox"]
    by_path = {file["path"]: file["content"] for file in sandbox["checkoutFiles"]}
    baseline = {path: by_path[path] for path in sandbox["targetFiles"]}
    candidate_files = dict(baseline)
    first_path = sandbox["targetFiles"][0]
    marker = "#" if first_path.endswith(".py") else "//"
    candidate_files[first_path] = (
        candidate_files[first_path].rstrip()
        + f"\n\n{marker} Elliott fixture candidate seed={request['seed']}\n"
    )
    content = _materialized(candidate_files)
    return [
        {
            "materializedContent": content,
            "patch": _combined_patch(baseline, candidate_files),
            "trace": {
                "engine": "fixture",
                "seed": request["seed"],
                "checkoutRef": sandbox["checkoutRef"],
                "upstreamRevision": UPSTREAM_REVISION,
            },
            "usage": {
                "inputTokens": 0,
                "outputTokens": 0,
                "costUsd": 0,
                "latencyMilliseconds": 0,
            },
            "validationScore": 0,
        }
    ]


def _real(request: dict[str, Any]) -> list[dict[str, Any]]:
    from companions.optimizers.darwinian.problem import run_evolution

    sandbox = request["codeSandbox"]
    by_path = {file["path"]: file["content"] for file in sandbox["checkoutFiles"]}
    baseline = {path: by_path[path] for path in sandbox["targetFiles"]}
    candidates: list[dict[str, Any]] = []
    indexes_by_organism: dict[str, int] = {}
    for organism, evaluation in run_evolution(request):
        content = _materialized(organism.files)
        parent = organism.parent
        parent_index = (
            indexes_by_organism.get(str(parent.id))
            if parent is not None and parent.parent is not None
            else None
        )
        candidate: dict[str, Any] = {
            "materializedContent": content,
            "patch": _combined_patch(baseline, organism.files),
            "trace": {
                "engine": "darwinian",
                "seed": request["seed"],
                "score": evaluation.score,
                "checkoutRef": sandbox["checkoutRef"],
                "upstreamRevision": UPSTREAM_REVISION,
                "organismId": str(organism.id),
                "parentOrganismId": str(parent.id) if parent is not None else None,
            },
            "usage": {
                "inputTokens": organism.input_tokens,
                "outputTokens": organism.output_tokens,
                "costUsd": organism.cost_usd,
                "latencyMilliseconds": organism.latency_milliseconds,
            },
            "validationScore": evaluation.score,
        }
        if parent_index is not None:
            candidate["parentIndex"] = parent_index
        indexes_by_organism[str(organism.id)] = len(candidates)
        candidates.append(candidate)
    return candidates


def optimize(value: dict[str, Any]) -> dict[str, Any]:
    request = value
    candidates = (
        _fixture(request)
        if os.getenv("ELLIOTT_COMPANION_FIXTURE") == "1"
        else _real(request)
    )
    return {"candidates": candidates}


if __name__ == "__main__":
    raise SystemExit(run_worker(optimize))
