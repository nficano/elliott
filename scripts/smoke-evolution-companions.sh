#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

smoke() {
  local name="$1"
  local image="$2"
  local port="$3"
  local request="$4"
  local kind="$5"
  local path="$6"
  local container="elliott-smoke-${name}-$$"

  docker run \
    --detach \
    --rm \
    --name "${container}" \
    --network none \
    --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --memory 1g \
    --cpus 1 \
    --env ELLIOTT_COMPANION_FIXTURE=1 \
    --mount "type=bind,source=${repository_root}/${request},target=/tmp/request.json,readonly" \
    "${image}" >/dev/null

  trap 'docker rm --force "${container}" >/dev/null 2>&1 || true' RETURN
  if [[ "${kind}" == "code-check" ]]; then
    docker exec "${container}" python -c '
import json
import time
import urllib.request
for _ in range(100):
    try:
        with urllib.request.urlopen("http://127.0.0.1:9073/healthz") as response:
            if json.load(response) == {"status": "ok"}:
                break
    except OSError:
        time.sleep(0.05)
else:
    raise SystemExit("companion did not become healthy")
with open("/tmp/request.json", encoding="utf-8") as source:
    payload = json.load(source)
request = urllib.request.Request(
    "http://127.0.0.1:9073/v1/candidate/check",
    data=json.dumps(payload).encode("utf-8"),
    method="POST",
    headers={"content-type": "application/json"},
)
with urllib.request.urlopen(request) as response:
    result = json.load(response)
if result.get("runId") != payload["run"]["id"]:
    raise SystemExit("code-check run binding mismatch")
if result.get("candidateId") != payload["candidate"]["id"]:
    raise SystemExit("code-check candidate binding mismatch")
if len(result.get("constraints", [])) != 3:
    raise SystemExit("code-check constraints are incomplete")
' >/dev/null
  else
    docker exec "${container}" \
      python -m elliott_companion.smoke \
        --endpoint "http://127.0.0.1:${port}" \
        --path "${path}" \
        --request /tmp/request.json \
        --kind "${kind}" >/dev/null
  fi
  docker rm --force "${container}" >/dev/null
  trap - RETURN
  echo "${name} smoke passed"
}

smoke \
  dspy \
  elliott/evaluator-dspy:local \
  9071 \
  companions/fixtures/dspy-request.json \
  optimizer \
  /v1/optimize
smoke \
  darwinian \
  elliott/evaluator-darwinian:local \
  9072 \
  companions/fixtures/darwinian-request.json \
  optimizer \
  /v1/optimize
smoke \
  benchmarks \
  elliott/evaluator-agent-benchmarks:local \
  9073 \
  companions/fixtures/benchmark-request.json \
  benchmark \
  /v1/run
smoke \
  independent-evaluator \
  elliott/evaluator-agent-benchmarks:local \
  9073 \
  companions/fixtures/evaluation-request.json \
  evaluator \
  /v1/compare
smoke \
  pre-optimization-baseline \
  elliott/evaluator-agent-benchmarks:local \
  9073 \
  companions/fixtures/evaluation-request.json \
  baseline \
  /v1/baseline
smoke \
  code-checker \
  elliott/evaluator-agent-benchmarks:local \
  9073 \
  companions/fixtures/code-check-request.json \
  code-check \
  /v1/candidate/check
