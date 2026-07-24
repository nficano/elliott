from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from elliott_companion.wire import canonical_json, sha256_text
from evaluation_worker import baseline, compare


class EvaluationWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_fixture = os.environ.get("ELLIOTT_COMPANION_FIXTURE")
        self.previous_config = os.environ.get("ELLIOTT_BENCHMARK_DRIVER_CONFIG")
        os.environ["ELLIOTT_COMPANION_FIXTURE"] = "1"
        os.environ["ELLIOTT_BENCHMARK_DRIVER_CONFIG"] = str(
            Path(__file__).with_name("benchmark-drivers.json").resolve()
        )
        fixture = (
            Path(__file__).parents[1] / "fixtures" / "evaluation-request.json"
        )
        self.request = json.loads(fixture.read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        for name, value in (
            ("ELLIOTT_COMPANION_FIXTURE", self.previous_fixture),
            ("ELLIOTT_BENCHMARK_DRIVER_CONFIG", self.previous_config),
        ):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_fixture_runs_bound_cases_and_complete_ladder(self) -> None:
        report = compare(self.request)
        self.assertTrue(report["passed"])
        self.assertEqual(report["runId"], self.request["run"]["id"])
        self.assertEqual(
            len(report["benchmarks"]),
            len(self.request["benchmarkGates"]),
        )
        self.assertEqual(
            {item["category"] for item in report["footprints"]},
            {"prompt", "inference", "runtime"},
        )
        self.assertTrue(
            all(
                item["snapshotId"] == self.request["candidateSnapshotId"]
                for item in report["candidateCases"]
            )
        )
        self.assertTrue(
            all(
                isinstance(item["trajectoryDigest"], str)
                for item in [
                    *report["baselineCases"],
                    *report["candidateCases"],
                ]
            )
        )

    def baseline_request(self) -> dict[str, object]:
        request = json.loads(json.dumps(self.request))
        for name in (
            "candidate",
            "candidateSnapshotId",
            "benchmarkGates",
            "footprintLimits",
            "confidenceLevel",
            "bootstrapIterations",
            "multipleComparisonCount",
            "requiredConstraints",
        ):
            request.pop(name)
        request["operation"] = "baseline"
        request["run"]["state"] = {
            "_tag": "dataset-ready",
            "datasetId": request["dataset"]["id"],
            "datasetDigest": request["dataset"]["digest"],
        }
        request["run"].pop("optimizationSeed", None)
        request["targetFootprintBytes"] = 128
        request.pop("evaluationPlanDigest")
        request["evaluationPlanDigest"] = sha256_text(canonical_json(request))
        return request

    def test_baseline_runs_validation_and_holdout_before_optimization(self) -> None:
        request = self.baseline_request()
        report = baseline(request)
        self.assertEqual(report["runId"], request["run"]["id"])
        self.assertEqual(
            [item["split"] for item in report["caseResults"]],
            ["validation", "holdout"],
        )
        self.assertEqual(
            report["trajectoryDigests"],
            [item["trajectoryDigest"] for item in report["caseResults"]],
        )
        self.assertEqual(
            {item["category"] for item in report["footprints"]},
            {"prompt", "inference", "runtime"},
        )
        self.assertEqual(
            {(item["metric"], item["split"]) for item in report["metrics"]},
            {
                ("correctness", "validation"),
                ("correctness", "holdout"),
            },
        )
        self.assertEqual(report["authoringRouteDigest"], request["authoringRouteDigest"])
        self.assertEqual(
            report["evaluationRouteDigest"],
            request["evaluationRouteDigest"],
        )
        self.assertEqual(report["environmentDigest"], request["environmentDigest"])
        self.assertEqual(report["seed"], request["seed"])

    def test_baseline_rejects_optimization_state(self) -> None:
        request = self.baseline_request()
        request["run"]["state"] = {
            "_tag": "optimizing",
            "startedAt": "2026-01-01T00:00:00Z",
            "candidateCount": 0,
        }
        request.pop("evaluationPlanDigest")
        request["evaluationPlanDigest"] = sha256_text(canonical_json(request))
        with self.assertRaisesRegex(ValueError, "dataset-ready"):
            baseline(request)

    def test_matching_author_and_judge_routes_fail_closed(self) -> None:
        self.request["evaluationRouteDigest"] = self.request[
            "authoringRouteDigest"
        ]
        with self.assertRaisesRegex(ValueError, "routes must be distinct"):
            compare(self.request)

    def test_plan_digest_drift_fails_closed(self) -> None:
        self.request["seed"] = 8
        with self.assertRaisesRegex(ValueError, "plan digest mismatch"):
            compare(self.request)

    def test_incomplete_benchmark_ladder_fails_closed(self) -> None:
        self.request["benchmarkGates"].pop()
        with self.assertRaisesRegex(ValueError, "complete benchmark ladder"):
            compare(self.request)


if __name__ == "__main__":
    unittest.main()
