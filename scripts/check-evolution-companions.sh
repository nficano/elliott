#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

export PYTHONPATH="${repository_root}"
export PYTHONPYCACHEPREFIX="/tmp/elliott-companion-pycache"

bun test \
  companions/evaluators/agent-benchmarks/server.test.ts \
  companions/optimizers/contract.test.ts \
  companions/optimizers/jobs/controller.test.ts \
  companions/runtime/http.test.ts

python3 -m unittest \
  companions/optimizers/dspy/tests/worker.py \
  companions/optimizers/darwinian/tests/worker.py

rg --files companions \
  -g '*.py' \
  -0 \
  | xargs -0 python3 -m py_compile

python3 -m json.tool companions/optimizers/dspy/fixtures/request.json >/dev/null
python3 -m json.tool companions/optimizers/darwinian/fixtures/request.json >/dev/null
python3 -m json.tool companions/evaluators/agent-benchmarks/benchmark/drivers.json >/dev/null
python3 -m json.tool companions/evaluators/agent-benchmarks/fixtures/benchmark.json >/dev/null
python3 -m json.tool companions/evaluators/agent-benchmarks/fixtures/evaluation.json >/dev/null
python3 -m json.tool companions/evaluators/agent-benchmarks/fixtures/code-check.json >/dev/null
python3 scripts/check-evolution-image-lock.py
