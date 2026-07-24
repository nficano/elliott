#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

export PYTHONPATH="${repository_root}/companions/common:${repository_root}/companions/dspy:${repository_root}/companions/darwinian:${repository_root}/companions/benchmarks:${repository_root}/companions/tests"

python3 -m unittest \
  companions/dspy/test_dspy_worker.py \
  companions/darwinian/test_darwinian_worker.py \
  companions/benchmarks/test_benchmark_worker.py \
  companions/benchmarks/test_code_check_worker.py \
  companions/benchmarks/test_evaluation_worker.py \
  companions/tests/test_job_server.py

rg --files companions \
  -g '*.py' \
  -0 \
  | xargs -0 python3 -m py_compile

python3 -m json.tool companions/benchmarks/benchmark-drivers.json >/dev/null
python3 -m json.tool companions/fixtures/dspy-request.json >/dev/null
python3 -m json.tool companions/fixtures/darwinian-request.json >/dev/null
python3 -m json.tool companions/fixtures/benchmark-request.json >/dev/null
python3 -m json.tool companions/fixtures/evaluation-request.json >/dev/null
python3 -m json.tool companions/fixtures/code-check-request.json >/dev/null
python3 scripts/check-evolution-image-lock.py
