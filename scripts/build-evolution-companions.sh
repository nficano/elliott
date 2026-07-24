#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_root="${1:-${repository_root}/.artifacts/evolution-companions}"
platform="${ELLIOTT_COMPANION_PLATFORM:-linux/arm64}"

mkdir -p "${artifact_root}"

build_image() {
  local name="$1"
  local dockerfile="$2"
  local archive="${artifact_root}/${name}.oci.tar"
  local tag="elliott/${name}:local"

  docker buildx build \
    --platform "${platform}" \
    --file "${repository_root}/${dockerfile}" \
    --tag "${tag}" \
    --output "type=oci,dest=${archive}" \
    "${repository_root}"

  local digest
  digest="$(
    tar -xOf "${archive}" index.json \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["manifests"][0]["digest"])'
  )"
  docker load --input "${archive}" >/dev/null
  echo "${name} ${tag} ${digest} ${archive}"
}

build_image "evaluator-dspy" "companions/dspy/Dockerfile"
build_image "evaluator-darwinian" "companions/darwinian/Dockerfile"
build_image "evaluator-agent-benchmarks" "companions/benchmarks/Dockerfile"
