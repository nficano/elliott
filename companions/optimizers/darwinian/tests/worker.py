from __future__ import annotations

import os
import unittest

from companions.optimizers.darwinian.worker import optimize
from companions.optimizers.python.worker import sha256_text


def request() -> dict:
    content = "export const value = 1;\n"
    return {
        "run": {
            "id": "evr_12345678",
            "engineKind": "darwinian",
            "target": {
                "targetClass": "code",
                "baselineDigest": "sha256:baseline",
            },
            "budgets": {
                "maximumCandidates": 2,
                "maximumTokens": 100,
                "maximumCostUsd": 1,
                "maximumDurationMilliseconds": 10_000,
                "maximumConcurrency": 1,
            },
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
            "trainCases": [],
            "validationCases": [],
            "holdoutSealed": True,
        },
        "baselineContent": content,
        "maximumCandidates": 2,
        "maximumTokens": 100,
        "maximumCostUsd": 1,
        "maximumDurationMilliseconds": 10_000,
        "maximumConcurrency": 1,
        "seed": 7,
        "codeSandbox": {
            "checkoutRef": "candidate://evc_12345678",
            "checkoutFiles": [
                {
                    "path": "src/value.ts",
                    "digest": sha256_text(content),
                    "content": content,
                    "executable": False,
                }
            ],
            "targetFiles": ["src/value.ts"],
            "testCommands": [["bun", "test"]],
            "cpuQuota": 1,
            "memoryMb": 512,
            "pids": 64,
            "timeoutMilliseconds": 5_000,
            "networkEnabled": False,
            "repositoryCredentialsMounted": False,
            "gitRemotePresent": False,
            "activeTreeWritable": False,
            "containerRuntimeSocketMounted": False,
        },
    }


class DarwinianWorkerTest(unittest.TestCase):
    def test_fixture_result_contains_only_target_patch(self) -> None:
        previous = os.environ.get("ELLIOTT_COMPANION_FIXTURE")
        os.environ["ELLIOTT_COMPANION_FIXTURE"] = "1"
        try:
            result = optimize(request())
        finally:
            if previous is None:
                os.environ.pop("ELLIOTT_COMPANION_FIXTURE", None)
            else:
                os.environ["ELLIOTT_COMPANION_FIXTURE"] = previous
        candidate = result["candidates"][0]
        self.assertIn("src/value.ts", candidate["patch"])
        self.assertNotIn("node_modules", candidate["patch"])
        self.assertEqual(candidate["validationScore"], 0)


if __name__ == "__main__":
    unittest.main()
