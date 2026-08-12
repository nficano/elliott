#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

export PYTHONPATH="${repository_root}"
export PYTHONPYCACHEPREFIX="/tmp/elliott-darwin-pycache"

bun test \
  darwin/evaluators/agent-benchmarks/server.test.ts \
  darwin/optimizers/contract.test.ts \
  darwin/optimizers/jobs/controller.test.ts \
  darwin/runtime/http.test.ts

python3 -m unittest \
  darwin/optimizers/dspy/tests/worker.py \
  darwin/optimizers/darwinian/tests/worker.py

rg --files darwin \
  -g '*.py' \
  -0 \
  | xargs -0 python3 -m py_compile

python3 -m json.tool darwin/optimizers/dspy/fixtures/request.json >/dev/null
python3 -m json.tool darwin/optimizers/darwinian/fixtures/request.json >/dev/null
python3 -m json.tool darwin/evaluators/agent-benchmarks/benchmark/drivers.json >/dev/null
python3 -m json.tool darwin/evaluators/agent-benchmarks/fixtures/benchmark.json >/dev/null
python3 -m json.tool darwin/evaluators/agent-benchmarks/fixtures/evaluation.json >/dev/null
python3 -m json.tool darwin/evaluators/agent-benchmarks/fixtures/code-check.json >/dev/null
python3 scripts/check-evolution-image-lock.py
