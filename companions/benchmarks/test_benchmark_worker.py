from __future__ import annotations

import os
import unittest
from pathlib import Path

from benchmark_worker import run_benchmark


def operation() -> dict:
    return {
        "operation": "runSubset",
        "run": {
            "id": "evr_12345678",
            "target": {"baselineDigest": "sha256:baseline"},
        },
        "candidate": {
            "id": "evc_12345678",
            "runId": "evr_12345678",
            "targetDigest": "sha256:baseline",
        },
        "benchmarkRef": "tblite-fast",
        "baselineSnapshotId": "snapshot-baseline",
        "candidateSnapshotId": "snapshot-candidate",
        "environmentDigest": "sha256:environment",
        "seed": 7,
        "timeoutMilliseconds": 10_000,
        "maximumCostUsd": 1,
    }


class BenchmarkWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_fixture = os.environ.get("ELLIOTT_COMPANION_FIXTURE")
        self.previous_config = os.environ.get("ELLIOTT_BENCHMARK_DRIVER_CONFIG")
        os.environ["ELLIOTT_COMPANION_FIXTURE"] = "1"
        os.environ["ELLIOTT_BENCHMARK_DRIVER_CONFIG"] = str(
            Path(__file__).with_name("benchmark-drivers.json").resolve()
        )

    def tearDown(self) -> None:
        for name, value in (
            ("ELLIOTT_COMPANION_FIXTURE", self.previous_fixture),
            ("ELLIOTT_BENCHMARK_DRIVER_CONFIG", self.previous_config),
        ):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_fixture_attests_snapshot_bindings(self) -> None:
        result = run_benchmark(operation())
        self.assertTrue(result["passed"])
        self.assertEqual(result["maximumRegressionRatio"], 0.02)
        self.assertTrue(result["reportDigest"].startswith("sha256:"))

    def test_candidate_run_mismatch_fails_closed(self) -> None:
        value = operation()
        value["candidate"]["runId"] = "evr_87654321"
        with self.assertRaisesRegex(ValueError, "not bound"):
            run_benchmark(value)

    def test_unknown_benchmark_fails_closed(self) -> None:
        value = operation()
        value["benchmarkRef"] = "invented"
        with self.assertRaisesRegex(ValueError, "driver invented"):
            run_benchmark(value)


if __name__ == "__main__":
    unittest.main()
