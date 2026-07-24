from __future__ import annotations

import os
import unittest

from code_check_worker import check_candidate
from elliott_companion.wire import sha256_text


def request() -> dict:
    baseline = "export const value = 1;\n"
    candidate = '{"files":{"src/value.ts":"export const value = 2;\\n"}}'
    return {
        "operation": "checkCandidate",
        "run": {
            "id": "evr_codecheck1",
            "target": {
                "targetClass": "code",
                "baselineDigest": "sha256:baseline",
            },
        },
        "candidate": {
            "id": "evc_codecheck1",
            "runId": "evr_codecheck1",
            "targetDigest": "sha256:baseline",
            "candidateDigest": sha256_text(candidate),
            "materializedContent": candidate,
        },
        "codeSandbox": {
            "checkoutRef": "candidate://code-check",
            "checkoutFiles": [
                {
                    "path": "src/value.ts",
                    "digest": sha256_text(baseline),
                    "content": baseline,
                    "executable": False,
                }
            ],
            "targetFiles": ["src/value.ts"],
            "testCommands": [["bun", "test"]],
            "cpuQuota": 1,
            "memoryMb": 512,
            "pids": 64,
            "timeoutMilliseconds": 30_000,
            "networkEnabled": False,
            "repositoryCredentialsMounted": False,
            "gitRemotePresent": False,
            "activeTreeWritable": False,
            "containerRuntimeSocketMounted": False,
        },
    }


class CodeCheckWorkerTest(unittest.TestCase):
    def test_fixture_report_is_complete_and_bound(self) -> None:
        previous = os.environ.get("ELLIOTT_COMPANION_FIXTURE")
        os.environ["ELLIOTT_COMPANION_FIXTURE"] = "1"
        try:
            report = check_candidate(request())
        finally:
            if previous is None:
                os.environ.pop("ELLIOTT_COMPANION_FIXTURE", None)
            else:
                os.environ["ELLIOTT_COMPANION_FIXTURE"] = previous
        self.assertEqual(report["candidateId"], "evc_codecheck1")
        self.assertEqual(len(report["constraints"]), 3)

    def test_candidate_digest_drift_fails_closed(self) -> None:
        value = request()
        value["candidate"]["candidateDigest"] = "sha256:wrong"
        with self.assertRaisesRegex(ValueError, "materialized digest"):
            check_candidate(value)


if __name__ == "__main__":
    unittest.main()
