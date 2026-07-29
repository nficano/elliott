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
    --env ELLIOTT_COMPANION_TOKEN=smoke-secret \
    --mount "type=bind,source=${repository_root}/${request},target=/tmp/request.json,readonly" \
    "${image}" >/dev/null

  trap 'docker rm --force "${container}" >/dev/null 2>&1 || true' RETURN
  if [[ "${image}" == "elliott/evaluator-agent-benchmarks:local" ]]; then
    docker exec "${container}" \
      bun /opt/elliott/companions/typescript/smoke.ts \
        --endpoint "http://127.0.0.1:${port}" \
        --path "${path}" \
        --request /tmp/request.json \
        --kind "${kind}" \
        --token smoke-secret >/dev/null
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
