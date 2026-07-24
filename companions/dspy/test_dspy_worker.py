from __future__ import annotations

import os
import unittest

from dspy_worker import lexical_score, optimize


def request() -> dict:
    case = {
        "id": "case-1",
        "groupId": "group-1",
        "split": "train",
        "input": {"question": "hi"},
        "expected": {"answer": "hello"},
        "classification": "public",
        "sourceDigests": ["sha256:source"],
        "timeoutMilliseconds": 1_000,
        "maximumCostUsd": 1,
        "allowedEffects": [],
    }
    validation = dict(case, id="case-2", groupId="group-2", split="validation")
    return {
        "run": {
            "id": "evr_12345678",
            "principalId": "optimizer",
            "baselineSnapshotId": "snapshot-baseline",
            "engineRef": "organization/evaluator/dspy",
            "engineKind": "gepa",
            "configurationDigest": "sha256:config",
            "target": {
                "targetClass": "skill",
                "componentRef": "workspace/skill/example",
                "baselineDigest": "sha256:baseline",
                "riskClass": "C1",
                "mutationPath": "SKILL.md",
                "allowedMutationPaths": ["SKILL.md"],
                "frozenPaths": [],
            },
            "budgets": {
                "maximumCandidates": 2,
                "maximumTokens": 100,
                "maximumCostUsd": 1,
                "maximumDurationMilliseconds": 10_000,
                "maximumConcurrency": 1,
            },
            "state": {
                "_tag": "optimizing",
                "startedAt": "2026-01-01T00:00:00Z",
                "candidateCount": 0,
            },
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        },
        "dataset": {
            "id": "evd_12345678",
            "targetDigest": "sha256:baseline",
            "digest": "sha256:dataset",
            "splitSeed": 7,
            "trainDigest": "sha256:train",
            "validationDigest": "sha256:validation",
            "classification": "public",
            "sources": [],
            "trainCases": [case],
            "validationCases": [validation],
            "holdoutSealed": True,
        },
        "baselineContent": "Answer accurately.",
        "maximumCandidates": 2,
        "maximumTokens": 100,
        "maximumCostUsd": 1,
        "maximumDurationMilliseconds": 10_000,
        "maximumConcurrency": 1,
        "seed": 7,
    }


class DspyWorkerTest(unittest.TestCase):
    def test_lexical_score(self) -> None:
        self.assertEqual(lexical_score({"answer": "hello"}, {"answer": "hello"}), 1)
        self.assertGreater(lexical_score("hello world", "hello"), 0)
        self.assertEqual(lexical_score("hello", "goodbye"), 0)

    def test_fixture_result_obeys_wire_shape(self) -> None:
        previous = os.environ.get("ELLIOTT_COMPANION_FIXTURE")
        os.environ["ELLIOTT_COMPANION_FIXTURE"] = "1"
        try:
            result = optimize(request())
        finally:
            if previous is None:
                os.environ.pop("ELLIOTT_COMPANION_FIXTURE", None)
            else:
                os.environ["ELLIOTT_COMPANION_FIXTURE"] = previous
        self.assertEqual(result["runId"], "evr_12345678")
        self.assertFalse(result["paused"])
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["validationScore"], 0)
        self.assertNotIn(
            "holdout", result["candidates"][0]["materializedContent"].casefold()
        )

    def test_holdout_content_is_rejected(self) -> None:
        value = request()
        value["dataset"]["holdoutCases"] = []
        with self.assertRaisesRegex(ValueError, "unexpected fields"):
            optimize(value)


if __name__ == "__main__":
    unittest.main()
