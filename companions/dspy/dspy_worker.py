from __future__ import annotations

import inspect
import os
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from elliott_companion.wire import (
    WireError,
    canonical_json,
    make_candidate,
    make_engine_result,
    make_patch,
    validate_optimizer_request,
)

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_MODE", "PRODUCTION")
os.environ.setdefault("DSPY_CACHEDIR", "/tmp/dspy-cache")
os.environ.setdefault("DSPY_CACHE_LIMIT", "268435456")


def _normalized(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = canonical_json(value)
    return " ".join(text.casefold().split())


def lexical_score(expected: Any, observed: Any) -> float:
    expected_text = _normalized(expected)
    observed_text = _normalized(observed)
    if expected_text == observed_text:
        return 1.0
    expected_tokens = re.findall(r"\w+", expected_text)
    observed_tokens = re.findall(r"\w+", observed_text)
    if not expected_tokens or not observed_tokens:
        return 0.0
    remaining = observed_tokens.copy()
    overlap = 0
    for token in expected_tokens:
        if token in remaining:
            overlap += 1
            remaining.remove(token)
    precision = overlap / len(observed_tokens)
    recall = overlap / len(expected_tokens)
    return (
        0.0
        if precision + recall == 0
        else 2 * precision * recall / (precision + recall)
    )


def _loopback_proxy() -> tuple[str, str, str]:
    endpoint = os.getenv("ELLIOTT_MODEL_PROXY_ENDPOINT", "")
    token = os.getenv("ELLIOTT_MODEL_PROXY_TOKEN", "")
    model = os.getenv("ELLIOTT_DSPY_MODEL", "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "::1",
        "localhost",
    }:
        raise WireError(
            "ELLIOTT_MODEL_PROXY_ENDPOINT must be an HTTP loopback endpoint"
        )
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise WireError(
            "model proxy endpoint may not contain credentials, query, or fragment"
        )
    if not token or not model:
        raise WireError(
            "a short-lived model proxy token and DSPy model route are required"
        )
    return endpoint.rstrip("/"), token, model


def _call_supported(function: Callable[..., Any], **kwargs: Any) -> Any:
    parameters = inspect.signature(function).parameters
    supported = {name: value for name, value in kwargs.items() if name in parameters}
    return function(**supported)


def _example(dspy: Any, case: dict[str, Any]) -> Any:
    return dspy.Example(
        input=canonical_json(case.get("input")),
        output=canonical_json(case.get("expected")),
        rubric=case.get("rubric") or "",
    ).with_inputs("input", "rubric")


def _metric(
    example: Any,
    prediction: Any,
    trace: Any = None,
    pred_name: Any = None,
    pred_trace: Any = None,
) -> float:
    del trace, pred_name, pred_trace
    observed = getattr(prediction, "output", prediction)
    return lexical_score(example.output, observed)


def _instructions(program: Any) -> str:
    signature = getattr(program, "signature", None)
    instructions = getattr(signature, "instructions", None)
    if isinstance(instructions, str) and instructions.strip():
        return instructions
    named_predictors = getattr(program, "named_predictors", None)
    if callable(named_predictors):
        values = []
        for name, predictor in named_predictors():
            predictor_signature = getattr(predictor, "signature", None)
            predictor_instructions = getattr(predictor_signature, "instructions", None)
            if (
                isinstance(predictor_instructions, str)
                and predictor_instructions.strip()
            ):
                values.append(f"[{name}]\n{predictor_instructions}")
        if values:
            return "\n\n".join(values)
    raise RuntimeError("DSPy returned a program without optimized instructions")


def _usage(lm: Any, elapsed_ms: int) -> dict[str, int | float]:
    input_tokens = 0
    output_tokens = 0
    cost = 0.0
    for entry in getattr(lm, "history", []) or []:
        if not isinstance(entry, dict):
            continue
        usage = entry.get("usage")
        if not isinstance(usage, dict):
            response = entry.get("response")
            usage = getattr(response, "usage", None)
        if isinstance(usage, dict):
            input_tokens += int(
                usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0
            )
            output_tokens += int(
                usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0
            )
            cost += float(usage.get("cost", 0) or 0)
        entry_cost = entry.get("cost")
        if isinstance(entry_cost, (int, float)):
            cost += float(entry_cost)
    return {
        "inputTokens": max(input_tokens, 0),
        "outputTokens": max(output_tokens, 0),
        "costUsd": max(cost, 0.0),
        "latencyMilliseconds": max(elapsed_ms, 0),
    }


def _optimize_with_dspy(
    request: dict[str, Any],
) -> tuple[str, dict[str, int | float], dict[str, Any], float]:
    import dspy

    endpoint, token, model = _loopback_proxy()
    maximum_concurrency = min(request["maximumConcurrency"], 32)
    maximum_calls = max(
        1,
        min(
            request["maximumCandidates"]
            * max(
                len(request["dataset"]["trainCases"])
                + len(request["dataset"]["validationCases"]),
                1,
            ),
            10_000,
        ),
    )
    lm = dspy.LM(
        model,
        api_base=endpoint,
        api_key=token,
        max_tokens=min(request["maximumTokens"], 32_768),
        cache=False,
    )
    signature = dspy.Signature(
        {
            "input": dspy.InputField(desc="Canonical JSON task input"),
            "rubric": dspy.InputField(desc="Optional task-specific rubric"),
            "output": dspy.OutputField(desc="Canonical JSON expected task response"),
        },
        instructions=request["baselineContent"],
    )
    student = dspy.Predict(signature)
    trainset = [_example(dspy, case) for case in request["dataset"]["trainCases"]]
    valset = [_example(dspy, case) for case in request["dataset"]["validationCases"]]
    if not trainset or not valset:
        raise WireError(
            "DSPy optimization requires non-empty train and validation splits"
        )
    engine_kind = request["run"]["engineKind"]
    started = time.monotonic()
    with dspy.context(lm=lm):
        if engine_kind == "gepa":
            optimizer = _call_supported(
                dspy.GEPA,
                metric=_metric,
                auto="light",
                max_metric_calls=maximum_calls,
                reflection_lm=lm,
                num_threads=maximum_concurrency,
                seed=request["seed"],
                track_stats=True,
                log_dir="/tmp/dspy-gepa",
            )
            compiled = _call_supported(
                optimizer.compile,
                student=student,
                trainset=trainset,
                valset=valset,
            )
        elif engine_kind == "miprov2":
            optimizer = _call_supported(
                dspy.MIPROv2,
                metric=_metric,
                prompt_model=lm,
                task_model=lm,
                auto="light",
                num_candidates=min(request["maximumCandidates"], 40),
                num_threads=maximum_concurrency,
                seed=request["seed"],
            )
            compiled = _call_supported(
                optimizer.compile,
                student=student,
                trainset=trainset,
                valset=valset,
                num_trials=min(request["maximumCandidates"], 40),
                max_bootstrapped_demos=4,
                max_labeled_demos=4,
                requires_permission_to_run=False,
            )
        else:
            raise WireError(f"DSPy worker does not support engine kind {engine_kind!r}")
        validation_scores = [
            _metric(
                example,
                compiled(input=example.input, rubric=example.rubric),
            )
            for example in valset
        ]
    elapsed_ms = round((time.monotonic() - started) * 1000)
    usage = _usage(lm, elapsed_ms)
    if usage["inputTokens"] + usage["outputTokens"] > request["maximumTokens"]:
        raise WireError("DSPy result exceeded the token budget")
    if usage["costUsd"] > request["maximumCostUsd"]:
        raise WireError("DSPy result exceeded the cost budget")
    return (
        _instructions(compiled),
        usage,
        {
            "engine": engine_kind,
            "modelRoute": model,
            "seed": request["seed"],
            "metric": "normalized-exact-and-token-f1",
            "trainDigest": request["dataset"]["trainDigest"],
            "validationDigest": request["dataset"]["validationDigest"],
            "maximumMetricCalls": maximum_calls,
        },
        sum(validation_scores) / len(validation_scores),
    )


def _fixture(
    request: dict[str, Any],
) -> tuple[str, dict[str, int | float], dict[str, Any], float]:
    baseline = request["baselineContent"]
    suffix = f"\n\n<!-- Elliott fixture candidate seed={request['seed']} -->\n"
    return (
        baseline.rstrip() + suffix,
        {
            "inputTokens": 0,
            "outputTokens": 0,
            "costUsd": 0.0,
            "latencyMilliseconds": 0,
        },
        {
            "engine": "fixture",
            "seed": request["seed"],
            "trainDigest": request["dataset"]["trainDigest"],
            "validationDigest": request["dataset"]["validationDigest"],
        },
        0,
    )


def optimize(value: dict[str, Any]) -> dict[str, Any]:
    request = validate_optimizer_request(value, code=False)
    if os.getenv("ELLIOTT_COMPANION_FIXTURE") == "1":
        content, usage, trace, validation_score = _fixture(request)
    else:
        content, usage, trace, validation_score = _optimize_with_dspy(request)
    mutation_path = request["run"]["target"].get("mutationPath") or "target.txt"
    patch = make_patch(request["baselineContent"], content, mutation_path)
    candidate = make_candidate(
        request,
        content,
        patch=patch,
        trace=trace,
        usage=usage,
        validation_score=validation_score,
    )
    return make_engine_result(request, [candidate])
